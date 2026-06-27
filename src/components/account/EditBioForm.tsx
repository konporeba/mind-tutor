import React, { useState } from "react";
import { Save } from "lucide-react";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { SuccessBanner } from "@/components/auth/SuccessBanner";
import { BIO_MAX } from "@/types";

interface Props {
  initialBio: string;
  serverError?: string | null;
  serverSuccess?: string | null;
}

export default function EditBioForm({ initialBio, serverError, serverSuccess }: Props) {
  const [bio, setBio] = useState(initialBio);
  const [error, setError] = useState<string | undefined>();

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (bio.trim().length === 0) {
      e.preventDefault();
      setError("Your bio can't be empty.");
    }
  }

  return (
    <form method="POST" action="/api/profiles/bio" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <div className="space-y-1">
        <textarea
          id="bio"
          name="bio"
          value={bio}
          maxLength={BIO_MAX}
          rows={6}
          placeholder="A few sentences about your background and what you're learning…"
          onChange={(e) => {
            setBio(e.target.value);
            if (error) setError(undefined);
          }}
          aria-label="Your bio"
          className="w-full resize-none rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-blue-100/40 focus:border-white/40 focus:outline-none"
        />
        <p className="text-right text-xs text-blue-100/50">
          {bio.length}/{BIO_MAX}
        </p>
      </div>

      <ServerError message={error ?? serverError} />
      <SuccessBanner message={serverSuccess} />

      <SubmitButton pendingText="Saving..." icon={<Save className="size-4" />}>
        Save bio
      </SubmitButton>
    </form>
  );
}
