"use client";

import React, { useEffect, useRef, useState } from "react";
import { FridgeCaptureSession } from "./fridge-capture";
import { modalFocusables, trapModalFocus } from "./modal-focus";
import { parseIngredient } from "./recipe-utils";
import type { RecipeDraft } from "./recipe-ocr";
import "./fridge-cook.css";

type Ingredient = { name: string; amount?: number; unit?: string; uncertain?: boolean; note?: string };
type IngredientRow = { id: number; name: string; amount: string; unit: string; uncertain: boolean; note: string };
type FridgeStatus = { configured: boolean; visionEnabled: boolean; textEnabled?: boolean; provider?: string; model?: string; reason?: string; retention?: { disclosure?: string; policyUrl?: string; providerName?: string }; limits?: { imageBytes: number; dailyCalls: number } };
type Proposal = { draft: RecipeDraft; missingIngredients: Ingredient[]; warnings?: string[] };
type Phase = "intro" | "camera" | "captured" | "recognizing" | "ingredients" | "generating" | "proposal";
const TIMEOUT = 60000;
const ingredientsText = (ingredients: Ingredient[]) => ingredients.map(ingredient => [ingredient.amount, ingredient.unit, ingredient.name].filter(value => value !== undefined && value !== "").join(" ")).join("\n");

/** Cloud vision is opt-in and gated by actual runtime configuration, unlike local printed-page OCR. */
export default function FridgeCook({ onClose, onDraft }: { onClose: () => void; onDraft: (draft: RecipeDraft) => void }) {
  const [status, setStatus] = useState<FridgeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>("intro");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [servings, setServings] = useState("4");
  const [preferences, setPreferences] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [recipeTitle, setRecipeTitle] = useState("");
  const [recipeIngredients, setRecipeIngredients] = useState("");
  const [recipeMethod, setRecipeMethod] = useState("");
  const [recipeNotes, setRecipeNotes] = useState("");
  const [missingIngredients, setMissingIngredients] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const capture = useRef<FridgeCaptureSession | null>(null);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const nextIngredient = useRef(0);
  const alive = useRef(false);
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const operationBusy = useRef(false);

  const stop = () => {
    generation.current++;
    controller.current?.abort(); controller.current = null;
    if (timer.current) clearTimeout(timer.current); timer.current = null;
    capture.current?.clear(); operationBusy.current = false;
  };
  const close = () => { stop(); closeRef.current(); };
  const requestJson = async (url: string, init: RequestInit, signal: AbortSignal) => {
    const pending = fetch(url, { ...init, signal, credentials: "same-origin", cache: "no-store" });
    init.body = undefined;
    const response = await pending;
    const result: any = await response.json();
    if (!response.ok) throw new Error(result.error?.message || result.error || "This request could not be completed. Your photo was discarded.");
    return result;
  };
  const run = async <T,>(label: string, fallback: Phase, work: (signal: AbortSignal) => Promise<T>, apply: (result: T) => void) => {
    if (operationBusy.current) return;
    operationBusy.current = true;
    const ticket = ++generation.current;
    const abort = new AbortController(); controller.current = abort;
    setBusy(label); setError(""); setNotice("");
    timer.current = setTimeout(() => {
      if (!alive.current || ticket !== generation.current) return;
      stop(); setBusy(""); setPhase(fallback); setLoading(false);
      setError("This took too long. The camera was stopped and any captured photo was discarded. Please try again.");
    }, TIMEOUT);
    try {
      const result = await work(abort.signal);
      if (alive.current && ticket === generation.current) apply(result);
    } catch (failure) {
      if (alive.current && ticket === generation.current) {
        capture.current?.clear(); setPhase(fallback); setLoading(false);
        setError(failure instanceof Error ? failure.message : "The request failed. Any captured photo was discarded.");
      }
    } finally {
      if (alive.current && ticket === generation.current) {
        if (timer.current) clearTimeout(timer.current); timer.current = null;
        controller.current = null; operationBusy.current = false; setBusy("");
      }
    }
  };
  const checkStatus = () => {
    setStatus(null); setLoading(true);
    void run("status", "intro", signal => requestJson("/api/recipes/fridge/status", {}, signal), result => { setStatus(result); setLoading(false); });
  };

  useEffect(() => {
    alive.current = true;
    capture.current = new FridgeCaptureSession({ video: () => video.current, canvas: () => canvas.current });
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    if (dialog.current) (modalFocusables(dialog.current)[0] || dialog.current).focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (dialog.current) trapModalFocus(event, dialog.current, document.activeElement);
    };
    const onHide = () => {
      if (!document.hidden && document.visibilityState !== "hidden") return;
      stop(); setBusy(""); setLoading(false);
      if (["camera", "captured", "recognizing"].includes(phaseRef.current)) setPhase("intro");
      else if (phaseRef.current === "generating") setPhase("ingredients");
      setNotice("Processing paused when this page was left. The camera was stopped and any photo was discarded.");
    };
    document.addEventListener("keydown", onKey); document.addEventListener("visibilitychange", onHide);
    checkStatus();
    return () => {
      alive.current = false; stop();
      document.removeEventListener("keydown", onKey); document.removeEventListener("visibilitychange", onHide);
      document.body.style.overflow = oldOverflow; previous?.focus();
    };
  }, []);

  const cloudDisclosure = status?.retention?.disclosure?.trim();
  const providerName = status?.retention?.providerName || status?.provider || "the configured AI provider";
  let policyUrl: string | undefined;
  try { const parsed = new URL(status?.retention?.policyUrl || ""); if (parsed.protocol === "https:" && !parsed.username && !parsed.password) policyUrl = parsed.href; } catch { /* No provider policy link is advertised until configured. */ }
  const visionEnabled = !!status?.configured && status.visionEnabled === true && !!cloudDisclosure;
  const textEnabled = !!status?.configured && status.textEnabled === true;
  const startCamera = () => {
    if (!visionEnabled || operationBusy.current) return;
    capture.current?.clear(); setPhase("camera"); setWarnings([]);
    void run("camera", "intro", async () => { await capture.current?.start(); }, () => setPhase("camera"));
  };
  const capturePhoto = () => {
    try { capture.current?.capture(); setPhase("captured"); setError(""); }
    catch (failure) { capture.current?.clear(); setPhase("intro"); setError(failure instanceof Error ? failure.message : "The photo could not be captured."); }
  };
  const readIngredients = () => {
    if (!visionEnabled || phase !== "captured") return;
    setPhase("recognizing");
    void run("recognize", "intro", async signal => {
      let image: Blob | null = await capture.current!.image();
      if (image.size > Math.min(status?.limits?.imageBytes || 1048576, 1048576)) { image = null; throw new Error("This capture is too large for photo identification. It was discarded. Retake a simpler, well-lit view of the ingredients."); }
      // The only image reference is transient. No object URL, storage or download is created.
      const pending = requestJson("/api/recipes/fridge/recognize", { method: "POST", headers: { "Content-Type": "image/jpeg", "X-Fridge-Processing-Acknowledged": "true" }, body: image }, signal);
      image = null;
      return await pending;
    }, result => {
      capture.current?.clear();
      const found: Ingredient[] = Array.isArray(result.ingredients) ? result.ingredients : [];
      setIngredients(found.map(ingredient => ({ id: nextIngredient.current++, name: ingredient.name || "", amount: ingredient.amount === undefined ? "" : String(ingredient.amount), unit: ingredient.unit || "", uncertain: ingredient.uncertain !== false, note: ingredient.note || "" })));
      setWarnings(Array.isArray(result.warnings) ? result.warnings : []); setConfirmed(false); setPhase("ingredients");
      setNotice("The photo was discarded by this app. Review the detected ingredients before asking for a recipe.");
      if (!found.length) setError("No ingredients were confidently identified. Add what you can see, or retake the photo.");
    });
  };
  const editIngredient = (id: number, patch: Partial<IngredientRow>) => { setIngredients(current => current.map(row => row.id === id ? { ...row, ...patch } : row)); setConfirmed(false); };
  const addIngredient = () => { setIngredients(current => [...current, { id: nextIngredient.current++, name: "", amount: "", unit: "", uncertain: false, note: "" }]); setConfirmed(false); };
  const reviewedIngredients = (): Ingredient[] => {
    const rows = ingredients.filter(row => row.name.trim());
    if (!rows.length) throw new Error("Add at least one ingredient name.");
    return rows.map(row => {
      const amount = row.amount.trim() ? Number(row.amount) : undefined;
      if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) throw new Error(`Check the quantity for ${row.name}. Leave it blank if unknown.`);
      return { name: row.name.trim(), amount, unit: row.unit.trim() || undefined, uncertain: row.uncertain || amount === undefined, note: row.note || undefined };
    });
  };
  const portions = () => { const value = Number(servings); if (!Number.isInteger(value) || value < 1 || value > 12) throw new Error("Choose between 1 and 12 servings."); return value; };
  const suggestRecipe = () => {
    if (!textEnabled || !confirmed) return;
    try {
      const input = { ingredients: reviewedIngredients(), servings: portions(), preferences: preferences.trim() };
      setPhase("generating");
      void run("suggest", "ingredients", signal => requestJson("/api/recipes/fridge/suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }, signal), result => {
        const next = result as Proposal;
        if (!next.draft?.title || !Array.isArray(next.draft.ingredients) || !next.draft.instructions) throw new Error("The service did not return a complete recipe proposal. Your reviewed ingredients are still available.");
        setProposal({ ...next, missingIngredients: next.missingIngredients || [] }); setRecipeTitle(next.draft.title); setRecipeIngredients(ingredientsText(next.draft.ingredients)); setRecipeMethod(next.draft.instructions); setRecipeNotes(next.draft.notes || ""); setMissingIngredients(ingredientsText(next.missingIngredients || [])); setServings(String(next.draft.servings || input.servings)); setPhase("proposal");
      });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Check your ingredients and servings."); }
  };
  const continueManually = () => {
    if (!confirmed || operationBusy.current) return;
    try {
      const checked = reviewedIngredients(); const count = portions(); stop();
      onDraft({ title: "", ingredients: checked.map(({ name, amount, unit }) => ({ name, amount, unit })), servings: count, instructions: "", notes: ["Started from reviewed fridge contents. No recipe has been generated.", preferences.trim(), ...checked.filter(row => row.uncertain).map(row => `Check available quantity: ${row.name}${row.note ? ` — ${row.note}` : ""}`)].filter(Boolean).join("\n") });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Check the ingredients first."); }
  };
  const continueWithProposal = () => {
    try {
      const checked = recipeIngredients.split("\n").map(line => line.trim()).filter(Boolean).map(parseIngredient);
      if (!recipeTitle.trim() || !checked.length || !recipeMethod.trim()) throw new Error("Review the recipe title, ingredients and method before continuing.");
      const count = portions(); stop();
      onDraft({ title: recipeTitle.trim(), ingredients: checked, instructions: recipeMethod.trim(), servings: count, notes: ["AI proposal from reviewed fridge ingredients. Check quantities, food condition and all dietary requirements before cooking.", recipeNotes.trim(), missingIngredients.trim() ? `You may still need: ${missingIngredients.trim().replace(/\n/g, "; ")}` : ""].filter(Boolean).join("\n") });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Check the proposal before continuing."); }
  };
  const editingInventory = phase === "ingredients" || phase === "generating";
  return <div className="modal-backdrop fridge-backdrop"><div ref={dialog} className="modal wide fridge-modal" role="dialog" aria-modal="true" aria-labelledby="fridge-title" tabIndex={-1}>
    <div className="modal-header"><div><span className="panel-kicker">MAKE SOMETHING OF WHAT YOU HAVE</span><h2 id="fridge-title">Cook from my fridge</h2></div><button className="button ghost" onClick={close} aria-label="Close fridge cooking">✕</button></div>
    <div className="modal-body"><ol className="fridge-steps" aria-label="Recipe suggestion steps"><li className={["intro", "camera", "captured", "recognizing"].includes(phase) ? "current" : ""}>1 · Capture</li><li className={editingInventory ? "current" : ""}>2 · Check ingredients</li><li className={phase === "proposal" ? "current" : ""}>3 · Review recipe</li></ol>
      {loading && <p role="status">Checking the private recipe service…</p>}
      {!loading && !visionEnabled && <div className="notice warning"><strong>Photo identification needs a connection</strong><p>{status?.reason || "The Site does not have a configured AI service for fridge photos yet. A ChatGPT subscription does not provide this Site with an API connection."}</p><p>The camera and image upload stay off until the service is configured. You can still enter ingredients and build a recipe manually.</p><button className="panel-link" disabled={!!busy} onClick={checkStatus}>Check service status again</button></div>}
      <video ref={video} className="fridge-camera" aria-label="Live fridge camera" muted playsInline hidden={phase !== "camera"}/><canvas ref={canvas} className="fridge-camera" role="img" aria-label="Captured fridge ingredients" hidden={phase !== "captured"}/>
      {phase === "intro" && <section className="fridge-intro"><span aria-hidden="true">⌑</span><h3>A little inspiration from your fridge</h3><p>Photograph the ingredients together in good light. You check what was identified, then review a recipe proposal and anything else you might need.</p>{visionEnabled && <p className="form-note">{cloudDisclosure}</p>}<div className="fridge-actions"><button className="button primary" disabled={loading || !!busy || !visionEnabled} onClick={startCamera}>Start fridge camera</button><button className="button ghost" disabled={!!busy} onClick={() => { setPhase("ingredients"); setError(""); if (!ingredients.length) addIngredient(); }}>Enter ingredients myself</button></div></section>}
      {phase === "camera" && <div className="fridge-actions"><button className="button primary" disabled={!!busy} onClick={capturePhoto}>Capture fridge ingredients</button><button className="button ghost" onClick={() => { stop(); setBusy(""); setPhase("intro"); }}>Stop camera</button></div>}
      {phase === "captured" && <><p className="form-note">Read ingredients sends this photo to {providerName} for identification. {cloudDisclosure}</p><div className="fridge-actions"><button className="button ghost" onClick={startCamera}>Retake photo</button><button className="button primary" onClick={readIngredients}>Read ingredients</button></div></>}
      {phase === "recognizing" && <p role="status">Identifying ingredients from your photo… <button className="button ghost" onClick={() => { stop(); setBusy(""); setPhase("intro"); setNotice("Identification cancelled. The camera was stopped and the photo was discarded."); }}>Cancel identification</button></p>}
      {editingInventory && <section><h3>What have you got?</h3><p className="subtle">Check names and quantities. A photo cannot reliably show every ingredient or how much is left. Blank quantities stay unknown.</p><div className="fridge-ingredient-list">{ingredients.map((ingredient, index) => <div className="fridge-ingredient-row" key={ingredient.id}><div className="fridge-ingredient-fields"><label className="field">Ingredient {index + 1}<input value={ingredient.name} disabled={!!busy} maxLength={200} onChange={event => editIngredient(ingredient.id, { name: event.target.value })}/></label><label className="field">Amount<input type="number" inputMode="decimal" min="0" step="any" value={ingredient.amount} placeholder="Unknown" disabled={!!busy} onChange={event => editIngredient(ingredient.id, { amount: event.target.value })}/></label><label className="field">Unit<input value={ingredient.unit} placeholder="e.g. g" maxLength={40} disabled={!!busy} onChange={event => editIngredient(ingredient.id, { unit: event.target.value })}/></label></div><div className="fridge-actions"><label className="check-row"><input type="checkbox" checked={ingredient.uncertain} disabled={!!busy} onChange={event => editIngredient(ingredient.id, { uncertain: event.target.checked })}/>Identification still uncertain</label><button className="panel-link danger" disabled={!!busy} onClick={() => { setIngredients(current => current.filter(row => row.id !== ingredient.id)); setConfirmed(false); }}>Remove ingredient {index + 1}</button></div>{(ingredient.uncertain || !ingredient.amount || ingredient.note) && <p className="fridge-ingredient-warning">{ingredient.note || (ingredient.uncertain ? "Check this identification before using it." : "Available quantity is unknown.")}</p>}</div>)}</div><button className="button ghost small" disabled={!!busy} onClick={addIngredient}>Add an ingredient</button><div className="fridge-options"><label className="field">Servings<input type="number" min="1" max="12" value={servings} disabled={!!busy} onChange={event => setServings(event.target.value)}/></label><label className="field">Dietary preferences / notes (optional)<textarea rows={3} maxLength={1000} value={preferences} disabled={!!busy} placeholder="e.g. Vegetarian, quick dinner, no nuts…" onChange={event => setPreferences(event.target.value)}/></label></div><label className="check-row"><input type="checkbox" checked={confirmed} disabled={!!busy} onChange={event => setConfirmed(event.target.checked)}/>I have checked these ingredients. Any unknown quantities should remain uncertain.</label>{!textEnabled && <p className="form-note">AI recipe suggestions need a configured recipe service. You can continue to the manual recipe editor using these ingredients.</p>}<div className="fridge-actions"><button className="button primary" disabled={!!busy || !confirmed || !textEnabled} onClick={suggestRecipe}>{phase === "generating" ? "Preparing a proposal…" : "Suggest a recipe"}</button><button className="button ghost" disabled={!!busy || !confirmed} onClick={continueManually}>Build a recipe manually</button>{visionEnabled && <button className="button ghost" disabled={!!busy} onClick={startCamera}>Take another photo</button>}</div>{phase === "generating" && <button className="panel-link" onClick={() => { stop(); setBusy(""); setPhase("ingredients"); setNotice("Recipe suggestion cancelled. Your reviewed ingredients are still here."); }}>Cancel suggestion</button>}</section>}
      {phase === "proposal" && proposal && <section className="fridge-proposal"><h3>Your recipe proposal</h3><p className="notice">This is a suggestion, not a confirmed inventory check. Review and edit every quantity, instruction and dietary requirement before saving.</p><label className="field">Recipe title<input value={recipeTitle} maxLength={200} onChange={event => setRecipeTitle(event.target.value)}/></label><label className="field">Servings<input type="number" min="1" max="12" value={servings} onChange={event => setServings(event.target.value)}/></label><label className="field">Recipe ingredients · one per line<textarea rows={7} value={recipeIngredients} onChange={event => setRecipeIngredients(event.target.value)}/></label><label className="field">Method<textarea rows={8} value={recipeMethod} onChange={event => setRecipeMethod(event.target.value)}/></label><label className="field">Notes<textarea rows={3} value={recipeNotes} onChange={event => setRecipeNotes(event.target.value)}/></label><aside className="fridge-missing-ingredients"><h4>You may still need</h4>{proposal.missingIngredients.length ? <ul>{proposal.missingIngredients.map((ingredient, index) => <li key={index}>{ingredientsText([ingredient])}{ingredient.uncertain ? " · check quantity" : ""}</li>)}</ul> : <p>No additional ingredients were proposed. Check quantities, cupboard staples and any substitutions yourself.</p>}<label className="field">Missing ingredients · edit after checking your cupboard<textarea rows={4} value={missingIngredients} onChange={event => setMissingIngredients(event.target.value)}/></label><p className="form-note">Nothing is added to shopping automatically. You can add the saved recipe’s ingredients to your list later.</p></aside>{proposal.warnings?.length ? <ul className="form-note">{proposal.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}<div className="fridge-actions"><button className="button ghost" onClick={() => setPhase("ingredients")}>Back to ingredients</button><button className="button primary" onClick={continueWithProposal}>Continue to recipe editor</button></div></section>}
      {warnings.length > 0 && editingInventory && <ul className="form-note">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      {busy === "camera" && <p role="status">Waiting for camera permission…</p>}{error && <p className="error-text" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
      <details className="fridge-privacy"><summary>What happens to the photo?</summary><p>Camera capture stays inside this website and does not save to Photos or download a file. Choosing Read ingredients sends the photo to the configured cloud service. The hub uses the image only for that request and does not save it to its database, files, browser storage, logs or backups.</p><p>{cloudDisclosure || "Cloud photo identification is not configured, so no photo can be sent. Provider and retention details must be available before capture is enabled."}</p>{policyUrl && <a className="panel-link" href={policyUrl} target="_blank" rel="noreferrer">{providerName}: image-processing policy</a>}<p>The app stops the camera and releases its photo references after reading, retake, cancellation, errors, timeouts, leaving the page and closing this flow. Browser and operating-system temporary buffers are outside the app’s control.</p><p>Only the recipe text you review and explicitly save becomes a household recipe. Printed recipe scanning remains on-device OCR and does not use this cloud-photo flow.</p></details>
    </div>
  </div></div>;
}
