import ForgeReconciler from '@forge/react';
import React from 'react';

/**
 * Monte un écran UI Kit 2 dans le pont Forge, sans jeter si le module est
 * importé hors navigateur (tests unitaires ou vérification de type).
 */
export function mountScreen(element: React.ReactElement): void {
  if (typeof (globalThis as { window?: unknown }).window === 'undefined') return;
  ForgeReconciler.render(element);
}
