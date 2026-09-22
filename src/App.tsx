import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "./api";
import { ToastProvider } from "./components/Toast";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";

type AuthState = "loading" | "authed" | "guest";

export function App() {
  const [auth, setAuth] = useState<AuthState>("loading");
  const [configured, setConfigured] = useState(true);
  const [edit, setEdit] = useState(false);

  async function checkSession() {
    try {
      const { authed, configured, edit } = await api.session();
      setConfigured(configured);
      if (authed) {
        setEdit(edit);
        setAuth("authed");
      } else {
        setAuth("guest");
      }
    } catch {
      setAuth("guest");
    }
  }

  useEffect(() => {
    checkSession();
  }, []);

  return (
    <ToastProvider>
      {auth === "loading" ? (
        <div className="flex min-h-screen items-center justify-center text-slate-500">
          <Loader2 className="mr-2 animate-spin" size={18} />
          正在校验会话...
        </div>
      ) : auth === "authed" ? (
        <Dashboard
          edit={edit}
          onEditChange={setEdit}
          onLogout={() => {
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
