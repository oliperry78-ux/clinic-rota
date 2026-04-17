/**
 * Pure display-state helpers shared by RotaPage and WeekShiftsPage.
 * Extracted so both pages use identical validity and display-state logic.
 */

export function receptionistComboIsCurrentlyValid(selectedComboLabel, combos) {
  if (!selectedComboLabel) return true;
  return combos.some((c) => c.label === selectedComboLabel);
}

/** "assigned" | "unassigned" | "gap" */
export function receptionistAssignmentDisplayState(selectedComboLabel, combos, requiredCapacity) {
  if (selectedComboLabel) return "assigned";
  if (combos.length > 0) return "unassigned";
  if (requiredCapacity <= 0) return "unassigned";
  return "gap";
}

/** "assigned" | "unassigned" | "gap" */
export function assistantAssignmentDisplayState(assignedId, eligibleAssistants) {
  if (assignedId) return "assigned";
  if (eligibleAssistants.length > 0) return "unassigned";
  return "gap";
}
