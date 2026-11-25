"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import {
  withCustomDiagnosis,
  withCustomMedicine,
  withMacros,
  withTemplate,
  type ConsultQueryData,
  type ConsultTemplate,
} from "@/features/consultation/screen";
import type { DoctorMacro } from "@/features/consultation/macros";

/**
 * The consult's query (V2-09e 09E-05, R-8): the doctor's own lists (custom medicines, custom diagnoses, templates), macros and the two learned-order reads
 * (favourites and usual doses live in `assistContext`/`rxAssistContext`). The page reads them once with the consult (`consult_screen`) and hydrates the
 * query; they stay in memory for the consult's lifetime. Nothing reads them again: a saved template or an edited macro updates the query from the action's
 * result (`setQueryData`), and a later server render of the page (after Finish, Amend, Finalize) replaces them with what the database now says.
 * There is no fetcher (`skipToken`): the query can be written, never re-read, so a focus or a reconnect cannot make a call.
 */
export interface ConsultQueryApi {
  data: ConsultQueryData;
  /** A saved template joins the list (the action's result). */
  addTemplate: (template: ConsultTemplate) => void;
  /** The macros after an edit in the macro list. */
  setMacros: (macros: DoctorMacro[]) => void;
  /** Lines the database accepted: a medicine outside the catalogue joins the doctor's own list (09C R-2, mirrored here; 09E-08). */
  addCustomMedicines: (lines: ReadonlyArray<Parameters<typeof withCustomMedicine>[1] & { cdci_brand_id: string | null }>) => void;
  /** A diagnosis the doctor added that is outside the catalogue joins the doctor's own list. */
  addCustomDiagnosis: (diagnosis: Parameters<typeof withCustomDiagnosis>[1]) => void;
}

const Context = createContext<ConsultQueryApi | null>(null);
export const ConsultQueryProvider = Context.Provider;

/** The consult's query, for a part of the screen below the workspace (the Templates sheet). `null` outside a consult. */
export function useConsultQueryApi(): ConsultQueryApi | null {
  return useContext(Context);
}

export function useConsultQuery(
  tenantId: string,
  visitId: string,
  server: ConsultQueryData
): ConsultQueryApi {
  const client = useQueryClient();
  const key = queryKeys.consult(tenantId, visitId);
  // 09E-14a (L4): coming back to a consult in the same tab (it stays cached for 5 minutes) must not show the lists as they were when it was left: the page that just
  // rendered read them from the database, so it replaces what the cache holds, once, before the first paint of this mount. (`initialData` alone only seeds an empty cache.)
  useState(() => {
    if (client.getQueryData(key) !== undefined) client.setQueryData(key, server);
    return true;
  });
  const query = useQuery({
    queryKey: key,
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    initialData: server,
  });
  const data = query.data ?? server;

  // A later server render of the page (a different `server` object) is newer than anything written here: the database answered after every save.
  const seen = useRef(server);
  useEffect(() => {
    if (seen.current === server) return;
    seen.current = server;
    client.setQueryData(key, server);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, client, tenantId, visitId]);

  const addTemplate = useCallback(
    (template: ConsultTemplate) =>
      client.setQueryData<ConsultQueryData>(key, (old) =>
        withTemplate(old ?? server, template)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, tenantId, visitId, server]
  );
  const setMacros = useCallback(
    (macros: DoctorMacro[]) =>
      client.setQueryData<ConsultQueryData>(key, (old) =>
        withMacros(old ?? server, macros)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, tenantId, visitId, server]
  );
  const addCustomMedicines = useCallback(
    (lines: ReadonlyArray<Parameters<typeof withCustomMedicine>[1] & { cdci_brand_id: string | null }>) =>
      client.setQueryData<ConsultQueryData>(key, (old) => lines.filter((l) => l.cdci_brand_id === null).reduce((acc, l) => withCustomMedicine(acc, l), old ?? server)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, tenantId, visitId, server]
  );
  const addCustomDiagnosis = useCallback(
    (diagnosis: Parameters<typeof withCustomDiagnosis>[1]) =>
      client.setQueryData<ConsultQueryData>(key, (old) => withCustomDiagnosis(old ?? server, diagnosis)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, tenantId, visitId, server]
  );
  return { data, addTemplate, setMacros, addCustomMedicines, addCustomDiagnosis };
}
