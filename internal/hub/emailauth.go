package hub

// 邮箱验证码：注册验证、「忘记密码」和设置页绑定邮箱共用同一条链路。
//
// 这套东西不是必须的：没配 SMTP 时（STARSTACK_SMTP_ADDR 为空）Broker 就把邮箱
// 当成一个未经验证的登录标识，注册照常走，只是没有验证码、也没有找回口令。
// 配了 SMTP，邮箱必须被验证过才能落库，避免一个人把别人的地址注册成自己的。

import (
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"mime"
	"net"
	"net/http"
	"net/smtp"
	"os"
	"strings"
	"time"

	"starstack/internal/auth"
	"starstack/internal/store"
)

const (
	codeTTL       = 10 * time.Minute
	codeCooldown  = 60 * time.Second
	codePerHour   = 5
	codeMaxTries  = 5
	purposeSignup = "register"
	purposeReset  = "reset"
	purposeBind   = "bind"
)

type mailer struct {
	addr        string
	user        string
	pass        string
	from        string // bare address used in MAIL FROM
	head        string // From: header, may carry a display name
	implicitTLS bool
}

// loadMailer reads the SMTP settings once at startup. Every field except the
// address is optional: a local relay on 127.0.0.1:25 needs no credentials.
func loadMailer() *mailer {
	addr := strings.TrimSpace(os.Getenv("STARSTACK_SMTP_ADDR"))
	if addr == "" {
		return nil
	}
	if _, _, err := net.SplitHostPort(addr); err != nil {
		log.Printf("SMTP: STARSTACK_SMTP_ADDR=%q 不是 host:port，邮箱验证与找回口令保持关闭", addr)
		return nil
	}
	m := &mailer{
		addr: addr,
		user: strings.TrimSpace(os.Getenv("STARSTACK_SMTP_USER")),
		pass: os.Getenv("STARSTACK_SMTP_PASS"),
		from: strings.TrimSpace(os.Getenv("STARSTACK_SMTP_FROM")),
	}
	if m.from == "" {
		m.from = m.user
	}
	display := strings.TrimSpace(os.Getenv("STARSTACK_SMTP_FROM_NAME"))
	if display != "" {
		m.head = display
	}
	if strings.HasSuffix(addr, ":465") {
		m.implicitTLS = true
	}
	if m.from == "" {
		log.Printf("SMTP: 缺少 STARSTACK_SMTP_FROM，邮件无法发出，邮箱验证保持关闭")
		return nil
	}
	log.Printf("SMTP: 已启用（%s，发件人 %s），邮箱验证码与找回口令可用", addr, m.from)
	return m
}

func (m *mailer) send(to, subject, body string) error {
	host, _, _ := net.SplitHostPort(m.addr)
	var c *smtp.Client
	var err error
	if m.implicitTLS {
		var conn *tls.Conn
		conn, err = tls.DialWithDialer(&net.Dialer{Timeout: 10 * time.Second}, "tcp", m.addr,
			&tls.Config{ServerName: host})
		if err != nil {
			return err
		}
		c, err = smtp.NewClient(conn, host)
	} else {
		c, err = smtp.Dial(m.addr)
		if err == nil {
			if ok, _ := c.Extension("STARTTLS"); ok {
				if err = c.StartTLS(&tls.Config{ServerName: host}); err != nil {
					c.Close()
					return err
				}
			}
		}
	}
	if err != nil {
		return err
	}
	defer c.Close()
	if m.user != "" {
		if err := c.Auth(smtp.PlainAuth("", m.user, m.pass, host)); err != nil {
			return err
		}
	}
	if err := c.Mail(m.from); err != nil {
		return err
	}
	if err := c.Rcpt(to); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write([]byte(m.message(to, subject, body))); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}

// message base64-encodes the body so an SMTP hop without 8BITMIME cannot mangle
// the Chinese text, and RFC 2047-encodes the subject for the same reason.
func (m *mailer) message(to, subject, body string) string {
	from := m.from
	if m.head != "" {
		from = mime.BEncoding.Encode("UTF-8", m.head) + " <" + m.from + ">"
	}
	var b strings.Builder
	b.WriteString("From: " + from + "\r\n")
	b.WriteString("To: " + to + "\r\n")
	b.WriteString("Subject: " + mime.BEncoding.Encode("UTF-8", subject) + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	b.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
	enc := base64.StdEncoding.EncodeToString([]byte(body))
	for len(enc) > 76 {
		b.WriteString(enc[:76] + "\r\n")
		enc = enc[76:]
	}
	b.WriteString(enc + "\r\n")
	return b.String()
}

// ---- codes ----

var (
	errCodeUnavailable = errors.New("本部署未配置邮件服务，暂不支持邮箱验证码")
	errCodeWrong       = errors.New("验证码不正确或已过期")
	errCodeRateLimited = errors.New("验证码获取过于频繁")
)

func codeHash(email, purpose, code string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(email)) + "\x00" + purpose + "\x00" + code))
	return hex.EncodeToString(sum[:])
}

// issueEmailCode mints, stores and mails a code. Mail failure is reported to the
// caller so the user is not told "已发送" for a message that never left.
func (s *Server) issueEmailCode(email, purpose string) error {
	if s.mail == nil {
		return errCodeUnavailable
	}
	if n, err := s.st.CountEmailCodes(email, time.Now().Add(-time.Hour).Unix()); err == nil && n >= codePerHour {
		return fmt.Errorf("%w：该邮箱一小时内最多获取 %d 次验证码", errCodeRateLimited, codePerHour)
	}
	if last, err := s.st.LatestEmailCode(email, purpose); err == nil &&
		time.Since(time.Unix(last.CreatedAt, 0)) < codeCooldown {
		return fmt.Errorf("%w：验证码刚发过，请一分钟后再获取", errCodeRateLimited)
	}
	code := auth.RandomDigits(6)
	if code == "" {
		return errors.New("验证码生成失败")
	}
	if err := s.st.PutEmailCode(email, purpose, codeHash(email, purpose, code), codeTTL); err != nil {
		return errors.New("验证码保存失败")
	}
	s.st.PurgeEmailCodes()
	if err := s.mail.send(email, "星栈算力 · 验证码 "+code, s.codeBody(purpose, code)); err != nil {
		log.Printf("SMTP send to %s: %v", email, err)
		return errors.New("邮件发送失败，请稍后再试或联系管理员")
	}
	return nil
}

func (s *Server) codeBody(purpose, code string) string {
	what := map[string]string{
		purposeSignup: "注册账号",
		purposeReset:  "重置登录口令",
		purposeBind:   "绑定邮箱",
	}[purpose]
	if what == "" {
		what = "账号操作"
	}
	return fmt.Sprintf("你在星栈算力发起了「%s」，验证码是：%s\r\n\r\n"+
		"验证码 %d 分钟内有效，只能使用一次。不是你本人操作请忽略这封邮件。\r\n\r\n"+
		"—— 星栈算力 StarStack\r\n", what, code, int(codeTTL.Minutes()))
}

// verifyEmailCode consumes a code. Wrong guesses are counted on the row, and a
// row that has used up its attempts is deleted, so a 6-digit code cannot be
// brute-forced inside its 10-minute life.
func (s *Server) verifyEmailCode(email, purpose, code string) error {
	code = strings.TrimSpace(code)
	if code == "" {
		return errors.New("请填写邮箱验证码")
	}
	row, err := s.st.LatestEmailCode(email, purpose)
	if err != nil {
		return errCodeWrong
	}
	if row.Attempts >= codeMaxTries {
		s.st.DeleteEmailCodes(email, purpose)
		return errors.New("验证码尝试次数过多，请重新获取")
	}
	if row.Hash != codeHash(email, purpose, code) {
		s.st.BumpEmailCodeAttempts(row.ID)
		return errCodeWrong
	}
	s.st.DeleteEmailCodes(email, purpose)
	return nil
}

// codeErrStatus maps a send failure to an HTTP status: "too many codes" is the
// caller's fault, "no SMTP / relay refused" is ours.
func codeErrStatus(err error) int {
	switch {
	case errors.Is(err, errCodeRateLimited):
		return http.StatusTooManyRequests
	case errors.Is(err, errCodeUnavailable):
		return http.StatusServiceUnavailable
	default:
		return http.StatusBadGateway
	}
}

// ---- handlers ----

// handleEmailCode is POST /api/auth/email/code {email, purpose}. It exists so a
// user can obtain a code before registering or before a password reset.
func (s *Server) handleEmailCode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, jsonErr("只支持 POST"), http.StatusMethodNotAllowed)
		return
	}
	if s.mail == nil {
		http.Error(w, jsonErr(errCodeUnavailable.Error()), http.StatusServiceUnavailable)
		return
	}
	if !s.authAllowed(w, r) {
		return
	}
	var req struct{ Email, Purpose string }
	if err := decodeJSON(r, &req); err != nil {
		http.Error(w, jsonErr("请求格式错误"), 400)
		return
	}
	email, err := auth.ValidEmail(req.Email)
	if err != nil {
		http.Error(w, jsonErr(err.Error()), 400)
		return
	}
	purpose := strings.TrimSpace(req.Purpose)
	switch purpose {
	case purposeSignup:
		if _, err := s.st.UserByEmail(email); err == nil {
			http.Error(w, jsonErr("该邮箱已被使用"), http.StatusConflict)
			return
		}
	case purposeReset, purposeBind:
		// Deliberately ambiguous: answering "该邮箱没有注册" here turns this
		// endpoint into a way to test whether someone has an account here.
		if _, err := s.st.UserByEmail(email); err != nil {
			writeJSON(w, map[string]any{"ok": true})
			return
		}
	default:
		http.Error(w, jsonErr("未知的验证码用途"), 400)
		return
	}
	if err := s.issueEmailCode(email, purpose); err != nil {
		http.Error(w, jsonErr(err.Error()), codeErrStatus(err))
		return
	}
	writeJSON(w, map[string]any{"ok": true, "expires_in": int(codeTTL.Seconds())})
}

// handlePasswordReset is POST /api/auth/reset {email, code, password}. Only
// reachable when SMTP is configured, so there is always a real mailbox behind
// the request instead of a self-declared address.
func (s *Server) handlePasswordReset(w http.ResponseWriter, r *http.Request) {
	if s.mail == nil {
		http.Error(w, jsonErr("本部署未配置邮件服务，无法自助找回口令"), http.StatusServiceUnavailable)
		return
	}
	if !s.authAllowed(w, r) {
		return
	}
	var req struct{ Email, Code, Password string }
	if err := decodeJSON(r, &req); err != nil {
		http.Error(w, jsonErr("请求格式错误"), 400)
		return
	}
	email, err := auth.ValidEmail(req.Email)
	if err != nil {
		http.Error(w, jsonErr(err.Error()), 400)
		return
	}
	if err := auth.ValidPassword(req.Password); err != nil {
		http.Error(w, jsonErr(err.Error()), 400)
		return
	}
	u, err := s.st.UserByEmail(email)
	if err != nil {
		// Same generic reply as a wrong code: no account enumeration.
		http.Error(w, jsonErr(errCodeWrong.Error()), http.StatusBadRequest)
		return
	}
	if err := s.verifyEmailCode(email, purposeReset, req.Code); err != nil {
		http.Error(w, jsonErr(err.Error()), http.StatusBadRequest)
		return
	}
	salt := auth.NewSalt()
	if err := s.st.SetUserPassword(u.ID, auth.Hash(req.Password, salt, auth.Iterations),
		hex.EncodeToString(salt), auth.Iterations); err != nil {
		http.Error(w, jsonErr("保存失败"), 500)
		return
	}
	s.st.DropUserSessions(u.ID)
	if !u.EmailVerified {
		s.st.SetUserEmail(u.ID, u.Email, true)
	}
	log.Printf("user %s reset password via email code", u.Name)
	writeJSON(w, map[string]any{"ok": true})
}

// ---- account-level email binding ----

// handleMyEmail is POST /api/me/email {email, code} and DELETE /api/me/email.
// With SMTP configured the first POST sends a code to the new address and the
// second one (carrying the code) binds it; without SMTP the address is stored
// as unverified, which is honest about what the broker actually knows.
func (s *Server) handleMyEmail(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if r.Method == http.MethodDelete {
		if u.Email != "" && u.PassHash == "" {
			if ids, _ := s.st.OAuthIdentitiesByUser(u.ID); len(ids) == 0 {
				http.Error(w, jsonErr("至少保留一种登录方式：请先设置口令或绑定第三方账号"), http.StatusConflict)
				return
			}
		}
		if err := s.st.SetUserEmail(u.ID, "", false); err != nil {
			http.Error(w, jsonErr("解绑失败"), 500)
			return
		}
		writeJSON(w, map[string]any{"ok": true})
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, jsonErr("只支持 POST / DELETE"), http.StatusMethodNotAllowed)
		return
	}
	var req struct{ Email, Code string }
	if err := decodeJSON(r, &req); err != nil {
		http.Error(w, jsonErr("请求格式错误"), 400)
		return
	}
	email, err := auth.ValidEmail(req.Email)
	if err != nil {
		http.Error(w, jsonErr(err.Error()), 400)
		return
	}
	if other, err := s.st.UserByEmail(email); err == nil && other.ID != u.ID {
		http.Error(w, jsonErr("该邮箱已绑定在其它账号上"), http.StatusConflict)
		return
	}
	verified := false
	if s.mail != nil {
		if strings.TrimSpace(req.Code) == "" {
			if err := s.issueEmailCode(email, purposeBind); err != nil {
				http.Error(w, jsonErr(err.Error()), codeErrStatus(err))
				return
			}
			writeJSON(w, map[string]any{"ok": true, "need_code": true,
				"expires_in": int(codeTTL.Seconds())})
			return
		}
		if err := s.verifyEmailCode(email, purposeBind, req.Code); err != nil {
			http.Error(w, jsonErr(err.Error()), http.StatusBadRequest)
			return
		}
		verified = true
	}
	if err := s.st.SetUserEmail(u.ID, email, verified); err != nil {
		http.Error(w, jsonErr("保存失败"), 500)
		return
	}
	writeJSON(w, map[string]any{"ok": true, "email": email, "email_verified": verified})
}

// emailTakenByOther reports whether an address already belongs to a different
// account, which is the only reason a signup must be refused.
func (s *Server) emailTakenByOther(email, userID string) *store.User {
	other, err := s.st.UserByEmail(email)
	if err != nil || other == nil || other.ID == userID {
		return nil
	}
	return other
}
