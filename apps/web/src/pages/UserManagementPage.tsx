import { useEffect, useState, type FormEvent } from "react";

import { usersApi } from "@/api/users";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  canReactivate,
  canResetOrDeactivate,
  MIN_PASSWORD_LENGTH,
  passwordProblem,
  type ManagedUser,
} from "@/users/userRules";
import { UserRequestError } from "@/users/usersApi";

type OpenDialog =
  | { kind: "add" }
  | { kind: "reset"; user: ManagedUser }
  | { kind: "deactivate"; user: ManagedUser };

function errorMessage(error: unknown) {
  return error instanceof UserRequestError ? error.message : "Something went wrong. Please try again.";
}

function UserManagementPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [reactivatingId, setReactivatingId] = useState<number | null>(null);

  useEffect(() => {
    usersApi
      .list()
      .then(setUsers)
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  async function reloadUsers() {
    try {
      setUsers(await usersApi.list());
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // Called by a dialog after its change has been saved.
  async function finishChange(message: string) {
    setDialog(null);
    setNotice(message);
    await reloadUsers();
  }

  async function handleReactivate(user: ManagedUser) {
    if (reactivatingId !== null) {
      return;
    }

    setReactivatingId(user.id);
    setNotice("");

    try {
      await usersApi.reactivate(user.id);
      setNotice(`${user.email} was reactivated and can log in again.`);
      await reloadUsers();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setReactivatingId(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">User Management</h1>

          <p className="mt-2 text-muted-foreground">
            Add warehouse users, reset their passwords and control their access.
          </p>
        </div>

        <Button type="button" onClick={() => setDialog({ kind: "add" })}>
          Add warehouse user
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className="mt-4 rounded-md border p-3 text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      <div className="mt-6 rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.email}</TableCell>
                <TableCell>{user.role === "ADMIN" ? "Admin" : "Warehouse"}</TableCell>
                <TableCell>{user.active ? "Active" : "Inactive"}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    {canResetOrDeactivate(user) && (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setDialog({ kind: "reset", user })}
                        >
                          Reset password
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => setDialog({ kind: "deactivate", user })}
                        >
                          Deactivate
                        </Button>
                      </>
                    )}

                    {canReactivate(user) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={reactivatingId !== null}
                        onClick={() => handleReactivate(user)}
                      >
                        {reactivatingId === user.id ? "Reactivating..." : "Reactivate"}
                      </Button>
                    )}

                    {user.role === "ADMIN" && (
                      <span className="text-sm text-muted-foreground">Protected</span>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}

            {!loading && users.length === 0 && !error && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No users found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Rendered only while open, so typed passwords don't outlive the dialog. */}
      {dialog?.kind === "add" && (
        <AddUserDialog onClose={() => setDialog(null)} onDone={finishChange} />
      )}

      {dialog?.kind === "reset" && (
        <ResetPasswordDialog user={dialog.user} onClose={() => setDialog(null)} onDone={finishChange} />
      )}

      {dialog?.kind === "deactivate" && (
        <DeactivateDialog user={dialog.user} onClose={() => setDialog(null)} onDone={finishChange} />
      )}
    </div>
  );
}

type DialogProps = {
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
};

function PasswordFields(props: {
  password: string;
  repeated: string;
  disabled: boolean;
  onPasswordChange: (value: string) => void;
  onRepeatedChange: (value: string) => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <label htmlFor="user-password" className="block text-sm font-medium">
          New password (at least {MIN_PASSWORD_LENGTH} characters)
        </label>
        <Input
          id="user-password"
          type="password"
          autoComplete="new-password"
          value={props.password}
          onChange={(event) => props.onPasswordChange(event.target.value)}
          disabled={props.disabled}
          required
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="user-password-repeat" className="block text-sm font-medium">
          Repeat the password
        </label>
        <Input
          id="user-password-repeat"
          type="password"
          autoComplete="new-password"
          value={props.repeated}
          onChange={(event) => props.onRepeatedChange(event.target.value)}
          disabled={props.disabled}
          required
        />
      </div>
    </>
  );
}

function DialogButtons(props: {
  saving: boolean;
  label: string;
  savingLabel: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" onClick={props.onCancel} disabled={props.saving}>
        Cancel
      </Button>
      <Button type="submit" disabled={props.saving}>
        {props.saving ? props.savingLabel : props.label}
      </Button>
    </div>
  );
}

function AddUserDialog({ onClose, onDone }: DialogProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeated, setRepeated] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (saving) {
      return;
    }

    const problem = email.trim() === "" ? "Email is required." : passwordProblem(password, repeated);

    if (problem) {
      setError(problem);
      return;
    }

    setError("");
    setSaving(true);

    try {
      await usersApi.create(email.trim(), password);
      await onDone(`Warehouse user ${email.trim().toLowerCase()} was added.`);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent>
        <DialogTitle>Add warehouse user</DialogTitle>
        <DialogDescription>
          The new user can log in straight away with this email and password.
        </DialogDescription>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <label htmlFor="user-email" className="block text-sm font-medium">
              Email
            </label>
            <Input
              id="user-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={saving}
              required
            />
          </div>

          <PasswordFields
            password={password}
            repeated={repeated}
            disabled={saving}
            onPasswordChange={setPassword}
            onRepeatedChange={setRepeated}
          />

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogButtons saving={saving} label="Add user" savingLabel="Adding..." onCancel={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose, onDone }: DialogProps & { user: ManagedUser }) {
  const [password, setPassword] = useState("");
  const [repeated, setRepeated] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (saving) {
      return;
    }

    const problem = passwordProblem(password, repeated);

    if (problem) {
      setError(problem);
      return;
    }

    setError("");
    setSaving(true);

    try {
      await usersApi.resetPassword(user.id, password);
      await onDone(`The password for ${user.email} was reset, and they were logged out.`);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent>
        <DialogTitle>Reset password</DialogTitle>
        <DialogDescription>
          Set a new password for {user.email}. They will be logged out everywhere.
        </DialogDescription>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <PasswordFields
            password={password}
            repeated={repeated}
            disabled={saving}
            onPasswordChange={setPassword}
            onRepeatedChange={setRepeated}
          />

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogButtons saving={saving} label="Reset password" savingLabel="Resetting..." onCancel={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeactivateDialog({ user, onClose, onDone }: DialogProps & { user: ManagedUser }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    if (saving) {
      return;
    }

    setError("");
    setSaving(true);

    try {
      await usersApi.deactivate(user.id);
      await onDone(`${user.email} was deactivated and logged out.`);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>Deactivate this user?</AlertDialogTitle>
        <AlertDialogDescription>
          {user.email} will be logged out and won't be able to log in until reactivated.
        </AlertDialogDescription>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleConfirm} disabled={saving}>
            {saving ? "Deactivating..." : "Deactivate"}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default UserManagementPage;
