import { hasEnv } from "@/server/env";
import { errorCode } from "@/server/firebase-admin";
import { toScene, totals, validateScriptEdit, type Script } from "@/features/projects/script";
import { getProject, saveScript, updateScript } from "@/server/projects";
import { SCRIPT_ERROR_STATUS, ScriptGenerationError, generateScript, targetSecondsOf } from "@/server/script-generation";
import { isScriptBusy, withScriptLock } from "@/server/script-lock";
import { getSessionUser } from "@/server/session";

// L'appel à Claude peut durer plusieurs dizaines de secondes.
export const maxDuration = 120;

/** Génère (ou régénère) le script du projet avec Claude, puis l'enregistre. */
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
  try {
    const locked = await withScriptLock(id, async () => saveScript(id, await generateScript(project)));
    if (!locked) return Response.json({ error: "in_progress" }, { status: 409 });
    return Response.json({ project: locked.value });
  } catch (error) {
    if (error instanceof ScriptGenerationError) {
      console.error("[script] generation failed", error.code, error.message);
      return Response.json({ error: error.code }, { status: SCRIPT_ERROR_STATUS[error.code] });
    }
    console.error("[script] save failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/** Enregistre une modification manuelle du script (gratuit : aucun appel à Claude). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const result = validateScriptEdit(body);
  if (!result.ok) return Response.json({ error: "invalid_input", fields: result.errors }, { status: 400 });

  try {
    const project = await getProject(user.uid, id);
    if (!project) return Response.json({ error: "not_found" }, { status: 404 });
    if (!project.script) return Response.json({ error: "no_script" }, { status: 409 });
    if (isScriptBusy(id)) return Response.json({ error: "in_progress" }, { status: 409 });
    return Response.json({ project: await updateScript(id, project.script, result.value) });
  } catch (error) {
    console.error("[script] edit failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/**
 * Écrit un script fourni tel quel (gratuit : aucun appel à Claude), même si le projet n'en a pas encore.
 * Corps identique à PATCH : { title, scenes: [{ spokenText, visualIntent, shot? }] }. Sert au connecteur MCP.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await request.json().catch(() => undefined);
  if (body === undefined) return Response.json({ error: "invalid_json" }, { status: 400 });
  const result = validateScriptEdit(body);
  if (!result.ok) return Response.json({ error: "invalid_input", fields: result.errors }, { status: 400 });

  try {
    const project = await getProject(user.uid, id);
    if (!project) return Response.json({ error: "not_found" }, { status: 404 });
    if (project.script) {
      if (isScriptBusy(id)) return Response.json({ error: "in_progress" }, { status: 409 });
      return Response.json({ project: await updateScript(id, project.script, result.value) });
    }
    const scenes = result.value.scenes.map((scene) => toScene(scene.spokenText, scene.visualIntent, scene.shot));
    const now = new Date().toISOString();
    const script: Script = {
      title: result.value.title,
      scenes,
      ...totals(scenes),
      targetSeconds: targetSecondsOf(project),
      model: "manual",
      generatedAt: now,
      editedAt: now,
    };
    // Le verrou évite d'écraser une génération lancée au même moment depuis l'app.
    const locked = await withScriptLock(id, () => saveScript(id, script));
    if (!locked) return Response.json({ error: "in_progress" }, { status: 409 });
    return Response.json({ project: locked.value });
  } catch (error) {
    console.error("[script] put failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
