export type DxfRoomText = {
  text: string;
  layer: string;
  type: string;
  position?: { x: number; y: number };
  startPoint?: { x: number; y: number };
};

export function cleanDxfText(value: string): string {
  return String(value || "")
    .replace(/\\P/g, " ")
    .replace(/\\[A-Za-z][^;]*;/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function roomNumberFromText(value: string): number | null {
  const match = cleanDxfText(value).match(/CHAMBRE\s*[-:]?\s*(\d{3})/i);
  const number = match ? Number(match[1]) : null;
  return number !== null && number >= 201 && number <= 240 ? number : null;
}

export function findRoomNumbers(entities: DxfRoomText[]): number[] {
  return [...new Set(entities
    .filter((entity) => entity.layer?.trim().toUpperCase() === "A-AREA-IDEN"
      && ["TEXT", "MTEXT"].includes(entity.type))
    .map((entity) => roomNumberFromText(entity.text))
    .filter((number): number is number => number !== null))].sort((a, b) => a - b);
}
