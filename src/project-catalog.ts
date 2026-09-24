export type ProjectDefinition = {
  id: string;
  name: string;
  description: string;
  floorLabel: string;
  dxfPath: string | null;
};

export const PROJECT_CATALOG: ProjectDefinition[] = [
  {
    id: "mixed-use",
    name: "Mixed Use",
    description: "Suivi des chambres du R+2",
    floorLabel: "R+2",
    dxfPath: "/projects/mixed-use/r2/a2.dxf",
  },
];
