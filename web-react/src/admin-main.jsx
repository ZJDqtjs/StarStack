import React from 'react'
import { createRoot } from 'react-dom/client'
import AdminApp from './AdminApp.jsx'
import { AdminProvider } from './AdminStore.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AdminProvider>
      <AdminApp />
    </AdminProvider>
  </React.StrictMode>
)