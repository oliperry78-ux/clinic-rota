import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./AuthContext.jsx";
import { BiweekAnchorProvider } from "./BiweekAnchorContext.jsx";
import { TempIsolationProvider } from "./TempIsolationContext.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <TempIsolationProvider>
        <AuthProvider>
          <BiweekAnchorProvider>
            <App />
          </BiweekAnchorProvider>
        </AuthProvider>
      </TempIsolationProvider>
    </BrowserRouter>
  </React.StrictMode>
);
