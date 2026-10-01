export type PinnedTask={id:string;label:string;group:string};
export type TaskCandidate={id:string;label:string;group:string};

const normalized=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr").replace(/\bsdb\b/g,"salle de bain").replace(/\bchambre\b/g,"").replace(/\s+/g," ").trim();

export function findPinnedTask(pinned:PinnedTask,candidates:TaskCandidate[]):TaskCandidate|null{
  const sameId=candidates.find(candidate=>candidate.id===pinned.id);
  if(sameId)return sameId;
  const label=normalized(pinned.label),sameLabel=candidates.find(candidate=>normalized(candidate.label)===label);
  if(sameLabel)return sameLabel;
  const sameGroup=candidates.filter(candidate=>normalized(candidate.group)===normalized(pinned.group));
  return sameGroup.length===1?sameGroup[0]:null;
}
