// Shared drag-to-reorder setup: press and hold anywhere on a row (touch or mouse) to pick it up,
// or use the keyboard (Space, arrows, Space). A short buzz on phones confirms the pick-up.
import { type DragStartEvent, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

export const HOLD_MS = 300;

export function useHoldToReorderSensors() {
  return useSensors(
    // a tap opens the row, a hold picks it up, a quick swipe still scrolls the page
    useSensor(TouchSensor, { activationConstraint: { delay: HOLD_MS, tolerance: 8 } }),
    useSensor(MouseSensor, { activationConstraint: { delay: HOLD_MS, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

export function buzzOnPickUp(_e?: DragStartEvent) {
  try {
    navigator.vibrate?.(15);
  } catch {
    /* not supported */
  }
}

/** Row styling while a row is lifted. */
export const liftedClass = 'relative z-10 scale-[1.01] shadow-lg ring-2 ring-brand-200';
