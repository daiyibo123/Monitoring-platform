import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "./api";
import { ToastProvider } from "./components/Toast";
import { Backdrop, BrandMark } from "./components/Backdrop";
import { clearKeySecrets } from "./lib/secrets";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";

type AuthState = "loading" | "authed" | "guest";

export function App() {
  const [auth, setAuth] = useState<AuthState>("loading");
  const [configured, setConfigured] = useState(true);
  const [edit, setEdit] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { authed, configured, edit } = await api.session();
        setConfigured(configured);
        setEdit(authed && edit);
        setAuth(authed ? "authed" : "guest");
      } catch {
        setAuth("guest");
      }
    })();
  }, []);

  return (
    <ToastProvider>
      {auth === "loading" ? (
        <div className="relative flex min-h-screen items-center justify-center">
          <Backdrop />
          <div className="relative z-10 flex flex-col items-center gap-4 text-dark-400">
            <BrandMark size={56} />
            <span className="flex items-center gap-2 text-sm">
              <Loader2 className="animate-spin" size={16} />
              正在校验会话…
            </span>
          </div>
        </div>
      ) : auth === "authed" ? (
        <Dashboard
          edit={edit}
          onEditChange={setEdit}
          onLogout={() => {
            clearKeySecrets();
            setEdit(false);
            setAuth("guest");
          }}
        />
      ) : (
        <Login
          configured={configured}
          onSuccess={() => {
            setEdit(false);
            setAuth("authed");
          }}
        />
      )}
    </ToastProvider>
  );
}
