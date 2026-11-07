/** Literal operator route is isolated before any family state is mounted. */
import App from "./App";
import AdminApp from "./pages/Admin";
import { StoreProvider } from "./lib/store";
export const isAdminPath = (path: string) => path.replace(/\/+$/, "") === "/admin";
export default function AppEntry() {
  return isAdminPath(window.location.pathname) ? <AdminApp /> : <StoreProvider><App /></StoreProvider>;
}
