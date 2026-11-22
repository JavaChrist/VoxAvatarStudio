import { durationFit } from "@/features/projects/script";
import { hasEnv } from "@/server/env";
import { errorCode } from "@/server/firebase-admin";
import { getProject, saveScript } from "@/server/projects";
import { SCRIPT_ERROR_STATUS, ScriptGenerationError, adjustScript } from "@/server/script-generation";
import { withScriptLock } from "@/server/script-lock";
import { getSessionUser } from "@/server/session";

// Jusqu'à 2 appels à Claude de 45 s au plus.
export const maxDuration = 120;

/** Ramène la durée du script dans la cible (±10 %) avec au plus 2 appels facturés ; aucun appel si elle y est déjà. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasEnv("ANTHROPIC_API_KEY")) return Response.json({ error: "not_configured" }, { status: 503 });
  const { id } = await params;

  let project;
  try {
    project = await getProject(user.uid, id);
  } catch (error) {
    console.error("[script] project read failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
  if (!project) return Response.json({ error: "not_found" }, { status: 404 });
  const current = project.script;
  if (!current) return Response.json({ error: "no_script" }, { status: 409 });
  if (durationFit(current.estimatedSeconds, current.targetSeconds) === "ok") {
    return Response.json({ project, attempts: 0, fit: "ok" });
  }

  try {
    const locked = await withScriptLock(id, async () => {
      const { script, attempts } = await adjustScript(project, current);
      const saved = script === current ? project : await saveScript(id, script);
      return { project: saved, attempts, fit: durationFit(script.estimatedSeconds, script.targetSeconds) };
    });
    if (!locked) return Response.json({ error: "in_progress" }, { status: 409 });
    return Response.json(locked.value);
  } catch (error) {
    if (error instanceof ScriptGenerationError) {
      console.error("[script] adjust failed", error.code, error.message);
      return Response.json({ error: error.code }, { status: SCRIPT_ERROR_STATUS[error.code] });
    }
    console.error("[script] adjust save failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
