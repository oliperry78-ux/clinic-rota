import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { BiweekAnchorProvider } from "./BiweekAnchorContext.jsx";
import { ManagerAuthProvider } from "./ManagerAuthContext.jsx";
import { TempIsolationProvider } from "./TempIsolationContext.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <BiweekAnchorProvider>
        <TempIsolationProvider>
          <ManagerAuthProvider>
            <App />
          </ManagerAuthProvider>
        </TempIsolationProvider>
      </BiweekAnchorProvider>
    </BrowserRouter>
  </React.StrictMode>
);
