import { jsx as _jsx } from "react/jsx-runtime";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.js";
import { ToastProvider } from "./components/ui/Toast.js";
import "./index.css";
ReactDOM.createRoot(document.getElementById("root")).render(_jsx(React.StrictMode, { children: _jsx(ToastProvider, { children: _jsx(App, {}) }) }));
