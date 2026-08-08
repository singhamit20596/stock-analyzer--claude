import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { installAuthFetch } from './auth'
import './index.css'

// Wraps fetch before any component can call it, so every API request carries
// the login token without each call site having to remember.
installAuthFetch()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
