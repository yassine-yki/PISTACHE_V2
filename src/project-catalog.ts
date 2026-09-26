export type ProjectDefinition = {
  id: string;
  name: string;
  description: string;
  floors: {
    id: string;
    label: string;
    dxfPath: string | null;
    updatedAt?: string;
  }[];
};

export const PROJECT_CATALOG: ProjectDefinition[] = [
  {
    id: "mixed-use",
    name: "Mixed Use",
    description: "Suivi des chambres du R+2 au R+5",
    floors: [
      { id: "r2", label: "R+2", dxfPath: "/projects/mixed-use/r2/suivi.dxf", updatedAt: "2026-09-26-095845" },
      { id: "r3", label: "R+3", dxfPath: "/projects/mixed-use/r3/suivi.dxf", updatedAt: "2026-09-26-095834" },
      { id: "r4", label: "R+4", dxfPath: "/projects/mixed-use/r4/suivi.dxf", updatedAt: "2026-09-26-095819" },
      { id: "r5", label: "R+5", dxfPath: "/projects/mixed-use/r5/suivi.dxf", updatedAt: "2026-09-26-100742" },
    ],
  },
];
