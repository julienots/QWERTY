import './ui/styles.css';
import { Game } from './Game';
import type { KeyValueStorage } from './core/SaveSystem';
import { MemoryStorage } from './core/SaveSystem';

/** localStorage when available (it can throw in private modes); in-memory fallback otherwise. */
function pickStorage(): KeyValueStorage {
  try {
    const k = '__ua_test__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    console.warn('localStorage indisponible : sauvegardes en mémoire uniquement');
    return new MemoryStorage();
  }
}

function showError(err: unknown) {
  const box = document.getElementById('fatal')!;
  box.classList.remove('hidden');
  box.querySelector('pre')!.textContent = String((err as Error)?.stack ?? err);
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

function boot() {
  const app = document.getElementById('app')!;
  const title = document.getElementById('title')!;
  if (!webglAvailable()) {
    showError(new Error("WebGL 2 n'est pas disponible sur cet appareil : le jeu ne peut pas afficher la 3D."));
    return;
  }
  const game = new Game(app, pickStorage());
  (window as any).__UA = game;

  const btnContinue = title.querySelector<HTMLButtonElement>('[data-action="continue"]')!;
  const btnNew = title.querySelector<HTMLButtonElement>('[data-action="new"]')!;
  const btnCreative = title.querySelector<HTMLButtonElement>('[data-action="creative"]')!;
  const confirm = document.getElementById('confirm-new')!;

  const refresh = () => {
    btnContinue.classList.toggle('hidden', !game.hasSave('survival'));
    btnCreative.textContent = game.hasSave('creative') ? 'Mode créatif — continuer' : 'Mode créatif';
  };
  const launch = (mode: 'survival' | 'creative', fresh: boolean) => {
    title.classList.add('hidden');
    confirm.classList.add('hidden');
    try {
      game.start(mode, fresh);
    } catch (err) {
      showError(err);
    }
  };
  btnContinue.addEventListener('click', () => launch('survival', false));
  btnNew.addEventListener('click', () => {
    if (game.hasSave('survival')) confirm.classList.remove('hidden');
    else launch('survival', true);
  });
  confirm.querySelector('[data-action="confirm"]')!.addEventListener('click', () => launch('survival', true));
  confirm.querySelector('[data-action="cancel"]')!.addEventListener('click', () => confirm.classList.add('hidden'));
  btnCreative.addEventListener('click', () => launch('creative', !game.hasSave('creative')));
  game.onExitToTitle = () => {
    refresh();
    title.classList.remove('hidden');
  };
  refresh();
  document.getElementById('loading')!.classList.add('hidden');
  title.classList.remove('hidden');
}

window.addEventListener('error', (e) => console.error(e.error ?? e.message));
try {
  boot();
} catch (err) {
  showError(err);
}
