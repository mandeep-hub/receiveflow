import { useState } from "react";
import { BrowserRouter, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { ClipboardList, PackageCheck, FileText, Menu, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AuthProvider } from "@/auth/AuthProvider";
import { LogoutError } from "@/auth/logoutRequest";
import { RequireAuth } from "@/auth/RequireAuth";
import { useAuth } from "@/auth/useAuth";
import LoginPage from "@/pages/LoginPage";
import PurchaseOrdersPage from "@/pages/PurchaseOrdersPage";
import PurchaseOrderDetailsPage from "@/pages/PurchaseOrderDetailsPage";
import ReceivingPage from "@/pages/ReceivingPage";
import ReportPage from "@/pages/ReportPage";

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Everything else needs a logged-in user. */}
          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route path="/" element={<PurchaseOrdersPage />} />
            <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
            <Route path="/purchase-orders/:id" element={<PurchaseOrderDetailsPage />} />
            <Route path="/receiving" element={<ReceivingPage />} />
            <Route path="/reports" element={<ReportPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { state, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  async function handleLogout() {
    if (loggingOut) {
      return;
    }

    setLoggingOut(true);
    setLogoutError("");

    try {
      await logout();
    } catch (err) {
      setLogoutError(
        err instanceof LogoutError
          ? err.message
          : "Logging out failed. You are still logged in. Please try again.",
      );
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="min-h-screen w-full">
      {/* Top Bar */}
      <header className="flex h-16 items-center border-b bg-background px-4">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="rounded-md p-2 hover:bg-muted"
          aria-label="Open menu"
        >
          <Menu className="h-6 w-6" />
        </button>

        <span className="ml-3 text-lg font-semibold">ReceiveFlow</span>

        {state.status === "authenticated" && (
          <div className="ml-auto flex items-center gap-3">
            {logoutError && (
              <p role="alert" className="text-right text-sm text-destructive">
                {logoutError}
              </p>
            )}

            <span className="hidden text-sm text-muted-foreground sm:inline">
              {state.user.email} ({state.user.role === "ADMIN" ? "Admin" : "Warehouse"})
            </span>

            <Button type="button" variant="outline" onClick={handleLogout} disabled={loggingOut}>
              {loggingOut ? "Logging out..." : "Log out"}
            </Button>
          </div>
        )}
      </header>

      {/* Overlay */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Menu */}
      <div
        className={`fixed left-0 top-0 z-50 h-full w-72 border-r bg-background shadow-lg transition-transform duration-200 ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b px-4">
          <span className="text-lg font-semibold">ReceiveFlow</span>

          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            className="rounded-md p-2 hover:bg-muted"
            aria-label="Close menu"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <NavigationMenu closeMenu={() => setMenuOpen(false)} />
      </div>

      {/* Main Content */}
      <main className="w-full p-8">
        <Outlet />
      </main>
    </div>
  );
}

type NavigationMenuProps = {
  closeMenu: () => void;
};

function NavigationMenu({ closeMenu }: NavigationMenuProps) {
  const navigate = useNavigate();

  function goTo(path: string) {
    navigate(path);
    closeMenu();
  }

  return (
    <nav className="p-4">
      <button
        type="button"
        onClick={() => goTo("/purchase-orders")}
        className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-sm font-medium hover:bg-muted"
      >
        <ClipboardList className="h-5 w-5" />
        <span>Purchase Orders</span>
      </button>

      <button
        type="button"
        onClick={() => goTo("/receiving")}
        className="mt-1 flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-sm font-medium hover:bg-muted"
      >
        <PackageCheck className="h-5 w-5" />
        <span>Receiving</span>
      </button>

      <button
        type="button"
        onClick={() => goTo("/reports")}
        className="mt-1 flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-sm font-medium hover:bg-muted"
      >
        <FileText className="h-5 w-5" />
        <span>Reports</span>
      </button>
    </nav>
  );
}

export default App;
