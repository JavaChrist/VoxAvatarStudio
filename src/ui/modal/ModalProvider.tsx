"use client";

import { createContext, use, useMemo, useRef, useState, type ReactNode } from "react";
import { ModalDialog } from "./ModalDialog";
import type { ModalApi, ModalContent, ModalRequest, ModalVariant } from "./types";

const ModalContext = createContext<ModalApi | null>(null);

export function ModalProvider({ children }: { children: ReactNode }) {
  // File d'attente : une seule modale à la fois, les suivantes s'ouvrent à la fermeture.
  const [queue, setQueue] = useState<ModalRequest[]>([]);
  const nextId = useRef(0);

  const api = useMemo<ModalApi>(() => {
    const open = (variant: ModalVariant, content: ModalRequest["content"], needsChoice: boolean) =>
      new Promise<{ confirmed: boolean; value: string }>((resolve) => {
        const id = nextId.current++;
        const settle = (confirmed: boolean, value: string) => resolve({ confirmed, value });
        setQueue((current) => [...current, { id, variant, content, needsChoice, resolve: settle }]);
      });
    const notify = (variant: ModalVariant, content: ModalContent) => open(variant, content, false).then(() => undefined);
    const choose = (variant: ModalVariant, content: ModalContent) => open(variant, content, true).then((reply) => reply.confirmed);

    return {
      info: (content) => notify("info", content),
      success: (content) => notify("success", content),
      error: (content) => notify("error", content),
      confirm: (content) => choose("confirm", content),
      destructive: (content) => choose("destructive", content),
      ask: (content) => open("confirm", content, true).then((reply) => (reply.confirmed ? reply.value : null)),
    };
  }, []);

  const current = queue[0];

  const handleSettled = (confirmed: boolean, value: string) => {
    current?.resolve(confirmed, value);
    setQueue((pending) => pending.slice(1));
  };

  return (
    <ModalContext value={api}>
      {children}
      {current && <ModalDialog key={current.id} request={current} onSettled={handleSettled} />}
    </ModalContext>
  );
}

export function useModal(): ModalApi {
  const api = use(ModalContext);
  if (!api) throw new Error("useModal doit être utilisé dans ModalProvider");
  return api;
}
