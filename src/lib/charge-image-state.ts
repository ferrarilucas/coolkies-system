export const CHARGE_IMAGE_MAX_INSTALLMENTS = 200;

export type ChargeImageErrorReason = "failed" | "stale";

export type ChargeImageState<T> = {
  key: string;
  token: number;
  status: "idle" | "loading" | "ready" | "error";
  file: T | null;
  reason: ChargeImageErrorReason | null;
};

export type ChargeImageAction<T> =
  | { type: "request"; key: string }
  | { type: "resolve"; token: number; file: T }
  | { type: "reject"; token: number; reason: ChargeImageErrorReason }
  | { type: "retry" }
  | { type: "reset" };

export function initialChargeImageState<T>(): ChargeImageState<T> {
  return { key: "", token: 0, status: "idle", file: null, reason: null };
}

export function chargeImageKey(input: { open: boolean; sendImage: boolean; selectedIds: string[] }): string {
  const { open, sendImage, selectedIds } = input;
  if (!open || !sendImage || selectedIds.length === 0) return "";
  if (selectedIds.length > CHARGE_IMAGE_MAX_INSTALLMENTS) return "";
  return selectedIds.join(",");
}

export function chargeImageReducer<T>(state: ChargeImageState<T>, action: ChargeImageAction<T>): ChargeImageState<T> {
  switch (action.type) {
    case "request": {
      if (!action.key) return chargeImageReducer(state, { type: "reset" });
      if (action.key === state.key && state.status !== "idle") return state;
      return { key: action.key, token: state.token + 1, status: "loading", file: null, reason: null };
    }
    case "resolve": {
      if (action.token !== state.token || state.status !== "loading") return state;
      return { ...state, status: "ready", file: action.file, reason: null };
    }
    case "reject": {
      if (action.token !== state.token || state.status !== "loading") return state;
      return { ...state, status: "error", file: null, reason: action.reason };
    }
    case "retry": {
      if (state.status !== "error" || !state.key) return state;
      return { ...state, token: state.token + 1, status: "loading", file: null, reason: null };
    }
    case "reset": {
      if (state.status === "idle" && state.key === "") return state;
      return { key: "", token: state.token + 1, status: "idle", file: null, reason: null };
    }
  }
}

export function isChargeImageReady<T>(state: ChargeImageState<T>, key: string): boolean {
  return state.status === "ready" && state.key === key && state.file !== null;
}

export function validateChargeImageResponse(
  res: { ok: boolean; redirected: boolean; contentType: string | null; totalCentsHeader: string | null },
  expectedCents: number,
): { ok: true } | { ok: false; reason: ChargeImageErrorReason } {
  if (!res.ok || res.redirected) return { ok: false, reason: "failed" };
  const mime = (res.contentType ?? "").split(";")[0].trim().toLowerCase();
  if (mime !== "image/png") return { ok: false, reason: "failed" };
  if (res.totalCentsHeader !== null && res.totalCentsHeader.trim() !== String(expectedCents)) {
    return { ok: false, reason: "stale" };
  }
  return { ok: true };
}
