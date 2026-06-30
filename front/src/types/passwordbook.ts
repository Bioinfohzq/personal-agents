export interface PasswordbookItemSummary {
  id: number;
  platform: string;
  login_account: string;
  login_url?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface PasswordbookItemDetail extends PasswordbookItemSummary {
  password: string;
}

export interface PasswordbookItemInput {
  platform: string;
  login_account: string;
  password: string;
  login_url: string;
  notes: string;
}
