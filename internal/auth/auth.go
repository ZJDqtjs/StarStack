package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// Iterations is deliberately conservative: ~150ms per hash on a laptop, which
// is invisible to a user logging in but makes offline cracking expensive.
const Iterations = 200_000

const (
	saltLen = 16
	keyLen  = 32
	MinPass = 8
)

var ErrWeakPassword = fmt.Errorf("password must be at least %d characters", MinPass)

var nameRe = regexp.MustCompile(`^[a-zA-Z0-9_\-\p{Han}]{2,24}$`)

func ValidName(name string) error {
	if !nameRe.MatchString(strings.TrimSpace(name)) {
		return errors.New("用户名需为 2-24 个字符（中英文、数字、_ 或 -）")
	}
	return nil
}

// emailRe is deliberately a shape check, not RFC 5322: the only thing a broker
// can honestly verify is that a code sent to the address comes back, and
// rejecting exotic-but-valid addresses is worse than accepting an odd one.
var emailRe = regexp.MustCompile("^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$")

// ValidEmail accepts an address of reasonable shape and returns it lower-cased,
// so the same mailbox never produces two accounts.
func ValidEmail(email string) (string, error) {
	e := strings.ToLower(strings.TrimSpace(email))
	if e == "" {
		return "", errors.New("邮箱不能为空")
	}
	if len(e) > 254 || !emailRe.MatchString(e) {
		return "", errors.New("邮箱格式不正确")
	}
	if dot := strings.LastIndexByte(e, '.'); dot < 0 || len(e)-dot < 3 {
		return "", errors.New("邮箱格式不正确")
	}
	return e, nil
}

func ValidPassword(pass string) error {
	if len([]rune(pass)) < MinPass {
		return ErrWeakPassword
	}
	return nil
}

// pbkdf2SHA256 is RFC 6070's construction with HMAC-SHA256 as PRF. Written here
// rather than pulled from x/crypto to keep the agent a single static binary.
func pbkdf2SHA256(password, salt []byte, iter, dkLen int) []byte {
	const hLen = sha256.Size
	dk := make([]byte, 0, dkLen)
	u := make([]byte, hLen)
	t := make([]byte, hLen)
	for block := 1; len(dk) < dkLen; block++ {
		prf := make([]byte, 0, len(salt)+4)
		prf = append(prf, salt...)
		var be [4]byte
		binary.BigEndian.PutUint32(be[:], uint32(block))
		prf = append(prf, be[:]...)

		hmacSum(password, prf, u)
		copy(t, u)
		for i := 1; i < iter; i++ {
			hmacSum(password, u, u)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		dk = append(dk, t...)
	}
	return dk[:dkLen]
}

func hmacSum(key, msg, out []byte) {
	h := hmac.New(sha256.New, key)
	h.Write(msg)
	copy(out, h.Sum(nil))
}

func RandomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// RandomDigits mints an n-digit numeric code (leading zeros kept) from
// crypto/rand, used for email verification. It never falls back to math/rand.
func RandomDigits(n int) string {
	if n <= 0 {
		return ""
	}
	buf := make([]byte, n)
	out := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand failing is fatal-worthy, but a broker should not panic on
		// a login request: refuse to produce a code instead of a predictable one.
		return ""
	}
	for i, b := range buf {
		out[i] = '0' + b%10
	}
	return string(out)
}

func NewSalt() []byte {
	b := make([]byte, saltLen)
	rand.Read(b)
	return b
}

func Hash(password string, salt []byte, iter int) string {
	return hex.EncodeToString(pbkdf2SHA256([]byte(password), salt, iter, keyLen))
}

func Match(password, saltHex, wantHex string, iter int) bool {
	salt, err := hex.DecodeString(saltHex)
	if err != nil || iter <= 0 {
		return false
	}
	got := Hash(password, salt, iter)
	return subtle.ConstantTimeCompare([]byte(got), []byte(wantHex)) == 1
}
