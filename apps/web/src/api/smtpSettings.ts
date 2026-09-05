import { request } from "./client";

export interface SmtpSettings {
  host: string | null;
  port: number;
  username: string | null;
  has_password: boolean;
  password_preview: string | null;
  from_address: string | null;
  use_tls: boolean;
  updated_at: string;
}

export interface SmtpSettingsUpdate {
  host: string | null;
  port: number;
  username: string | null;
  // Omit to leave a previously-saved password unchanged.
  password?: string;
  from_address: string | null;
  use_tls: boolean;
}

export const smtpSettingsApi = {
  get: () => request<SmtpSettings>("/api/v1/admin/smtp-settings"),
  update: (body: SmtpSettingsUpdate) =>
    request<SmtpSettings>("/api/v1/admin/smtp-settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  testEmail: (to: string) =>
    request<void>("/api/v1/admin/smtp-settings/test-email", {
      method: "POST",
      body: JSON.stringify({ to }),
    }),
};
