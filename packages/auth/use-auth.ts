"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { AuthController } from "./controller.ts";
export function useAuth(controller: AuthController) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  useEffect(() => { void controller.refresh(); }, [controller]);
  return state;
}
