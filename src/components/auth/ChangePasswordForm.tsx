import React, { useState } from "react";
import { Lock, KeyRound, Check } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { SuccessBanner } from "@/components/auth/SuccessBanner";

const MIN_PASSWORD_LENGTH = 8;

interface Props {
  serverError?: string | null;
  serverSuccess?: string | null;
}

interface FieldErrors {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

export default function ChangePasswordForm({ serverError, serverSuccess }: Props) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  function validate() {
    const next: FieldErrors = {};
    if (!currentPassword) {
      next.currentPassword = "Current password is required";
    }
    if (!newPassword) {
      next.newPassword = "New password is required";
    } else if (newPassword.length < MIN_PASSWORD_LENGTH) {
      next.newPassword = `New password must be at least ${MIN_PASSWORD_LENGTH} characters`;
    } else if (newPassword === currentPassword) {
      next.newPassword = "New password must be different from the current password";
    }
    if (!confirmPassword) {
      next.confirmPassword = "Please confirm your new password";
    } else if (confirmPassword !== newPassword) {
      next.confirmPassword = "Passwords do not match";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: keyof FieldErrors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  return (
    <form method="POST" action="/api/auth/change-password" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="currentPassword"
        label="Current password"
        type={showCurrent ? "text" : "password"}
        value={currentPassword}
        onChange={(v) => {
          setCurrentPassword(v);
          clearError("currentPassword");
        }}
        placeholder="Your current password"
        error={errors.currentPassword}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showCurrent}
            onToggle={() => {
              setShowCurrent(!showCurrent);
            }}
          />
        }
      />

      <FormField
        id="newPassword"
        label="New password"
        type={showNew ? "text" : "password"}
        value={newPassword}
        onChange={(v) => {
          setNewPassword(v);
          clearError("newPassword");
        }}
        placeholder="At least 8 characters"
        error={errors.newPassword}
        icon={<KeyRound className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showNew}
            onToggle={() => {
              setShowNew(!showNew);
            }}
          />
        }
      />

      <FormField
        id="confirmPassword"
        label="Confirm new password"
        type={showConfirm ? "text" : "password"}
        value={confirmPassword}
        onChange={(v) => {
          setConfirmPassword(v);
          clearError("confirmPassword");
        }}
        placeholder="Re-enter your new password"
        error={errors.confirmPassword}
        icon={<KeyRound className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showConfirm}
            onToggle={() => {
              setShowConfirm(!showConfirm);
            }}
          />
        }
      />

      <ServerError message={serverError} />
      <SuccessBanner message={serverSuccess} />

      <SubmitButton pendingText="Updating..." icon={<Check className="size-4" />}>
        Change password
      </SubmitButton>
    </form>
  );
}
