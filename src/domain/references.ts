import source from "../../data/dri-nasem-2019.json";
import { records, type Row } from "../db/records";
import type { Profile } from "./profile";
import { nutrientMetadata } from "./nutrition";

const references = source.groups.flatMap(
  ({ minAge, maxAge, physiology, values }) =>
    values.map(([key, kind, amount, scope]) =>
      records.nutrient_references.parse({
        id: `${source.version}:${physiology}:${minAge}:${key}:${kind}`,
        key,
        kind,
        amount,
        scope,
        minAge,
        maxAge,
        physiology,
        source: source.source,
        version: source.version,
        unit: nutrientMetadata.find((row) => row.key === key)?.unit,
      }),
    ),
);

export function applicableReferences(
  profile: Profile | undefined,
  local: Row<"nutrient_references">[],
) {
  if (!profile?.physiology || !profile.useWellnessEstimates) return [];
  const rows = [...references, ...local].filter(
    (row) =>
      profile.age >= row.minAge &&
      profile.age <= row.maxAge &&
      (row.physiology === profile.physiology || row.physiology === "any"),
  );
  return [
    ...new Map(
      rows.map((row) => [`${row.key}:${row.kind}:${row.scope}`, row]),
    ).values(),
  ];
}
