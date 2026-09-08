import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function App() {
  return (
    <div className="min-h-screen p-8">
      <h1 className="text-4xl font-bold">ReceiveFlow</h1>

      <Card className="mt-6 max-w-md">
        <CardHeader>
          <CardTitle>Purchase Orders</CardTitle>
        </CardHeader>

        <CardContent>
          <p className="text-muted-foreground">
            Manage incoming purchase orders.
          </p>

          <Button className="mt-4">View Purchase Orders</Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default App;
