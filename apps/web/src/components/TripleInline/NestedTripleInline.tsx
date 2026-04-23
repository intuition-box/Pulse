import { TripleInline } from "./TripleInline";

export type NestedTripleShape = {
  subject: string;
  predicate: string;
  object: string;
  subjectNested?: NestedTripleShape | null;
  objectNested?: NestedTripleShape | null;
};

type NestedTripleInlineProps = {
  data: NestedTripleShape;
  wrap?: boolean;
  nested?: boolean;
};

export function NestedTripleInline({ data, wrap, nested = false }: NestedTripleInlineProps) {
  return (
    <TripleInline
      subject={data.subjectNested ? <NestedTripleInline data={data.subjectNested} nested /> : data.subject}
      predicate={data.predicate}
      object={data.objectNested ? <NestedTripleInline data={data.objectNested} nested /> : data.object}
      wrap={wrap}
      nested={nested}
    />
  );
}
