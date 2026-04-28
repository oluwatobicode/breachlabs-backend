export interface ClerkUserData {
  id: string;
  username: string | null;
  email_addresses: { email_address: string; id: string }[];
  primary_email_address_id: string;
  image_url: string;
  external_accounts: { provider: string }[];
}
