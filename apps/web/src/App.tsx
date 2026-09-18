import { useState } from "react";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { ClipboardList, PackageCheck, FileText, Menu, X } from "lucide-react";

import PurchaseOrdersPage from "@/pages/PurchaseOrdersPage";
import PurchaseOrderDetailsPage from "@/pages/PurchaseOrderDetailsPage";
import ReceivingPage from "@/pages/ReceivingPage";
import ReportPage from "@/pages/ReportPage";

function App() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <BrowserRouter>
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
          <Routes>
            <Route path="/" element={<PurchaseOrdersPage />} />

            <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />

            <Route
              path="/purchase-orders/:id"
              element={<PurchaseOrderDetailsPage />}
            />

            <Route path="/receiving" element={<ReceivingPage />} />
            <Route path="/reports" element={<ReportPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
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
