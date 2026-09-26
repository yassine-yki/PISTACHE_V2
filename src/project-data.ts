import type { RoomDefinition } from "./model.js";

type RoomInput = [number: number, blockId: string, roomType: string];

const R2_ROOM_INPUT: RoomInput[] = [
  [201, "A", "standard"], [202, "A", "standard"], [203, "A", "junior"],
  [204, "A", "standard"], [205, "A", "standard"], [206, "A", "junior"],
  [207, "A", "standard"], [218, "A", "standard"], [219, "A", "standard"],
  [220, "A", "standard"], [237, "A", "standard"], [238, "A", "standard"],
  [239, "A", "standard"], [240, "A", "standard"], [235, "A", "junior"],
  [236, "A", "standard"],
  [208, "B", "standard"], [209, "B", "junior"], [210, "B", "junior"],
  [211, "B", "standard"], [212, "B", "junior"], [213, "B", "standard"],
  [214, "B", "executive"], [215, "B", "standard"], [216, "B", "standard"],
  [217, "B", "junior"], [221, "B", "standard"], [222, "B", "standard"],
  [223, "C", "standard"], [224, "C", "standard"], [225, "C", "standard"],
  [226, "C", "standard"], [227, "C", "junior"], [228, "C", "standard"],
  [229, "C", "standard"], [230, "C", "standard"], [231, "C", "standard"],
  [232, "C", "standard"], [233, "C", "standard"], [234, "C", "standard"],
];

export const R2_ROOMS: RoomDefinition[] = R2_ROOM_INPUT
  .map(([number, blockId, roomType]) => ({
    id: `r2-${number}`,
    floorId: "r2",
    number,
    blockId,
    roomType,
  }))
  .sort((first, second) => first.number - second.number);

const cloneFloorRooms = (source: RoomDefinition[], floorId: string, offset: number): RoomDefinition[] =>
  source.map((room) => ({
    ...room,
    id: `${floorId}-${room.number + offset}`,
    floorId,
    number: room.number + offset,
  }));

const detectedFloorRooms = (floorId: string, numbers: number[]): RoomDefinition[] =>
  numbers.map((number) => ({
    id: `${floorId}-${number}`,
    floorId,
    number,
    blockId: null,
    roomType: "standard",
  }));

export const ROOMS_BY_FLOOR: Record<string, RoomDefinition[]> = {
  r2: R2_ROOMS,
  r3: cloneFloorRooms(R2_ROOMS, "r3", 100),
  r4: detectedFloorRooms("r4", Array.from({ length: 24 }, (_, index) => 401 + index)),
  r5: detectedFloorRooms("r5", Array.from({ length: 25 }, (_, index) => 501 + index)),
};

export const R2_BLOCKS = ["A", "B", "C"] as const;
