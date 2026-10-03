export type DocumentSectionId =
  | "identity"
  | "education"
  | "address"
  | "previous_employer"
  | "bank";

export type DocumentTypeSpec = {
  id: string;
  label: string;
  section: DocumentSectionId;
  sectionLabel: string;
  maxFiles: number;
  minFiles: number;
  /** If set, at least one type in the group must be satisfied (each with minFiles). */
  oneOfGroup?: string;
  slotLabels?: string[];
  helpText?: string;
};

export const DOCUMENT_SECTION_LABELS: Record<DocumentSectionId, string> = {
  identity: "Identity",
  education: "Education",
  address: "Address proof (upload one)",
  previous_employer: "Previous company",
  bank: "Bank proof (upload one)",
};

export const DOCUMENT_TYPE_SPECS: DocumentTypeSpec[] = [
  { id: "aadhar", label: "Aadhar", section: "identity", sectionLabel: "Identity", maxFiles: 1, minFiles: 1 },
  { id: "pan", label: "PAN", section: "identity", sectionLabel: "Identity", maxFiles: 1, minFiles: 1 },
  {
    id: "education",
    label: "Education certificates",
    section: "education",
    sectionLabel: "Education",
    maxFiles: 10,
    minFiles: 2,
    slotLabels: ["10th certificate", "12th certificate"],
    helpText: "Upload 10th and 12th marksheets or certificates first. Use Add more for graduation, diplomas, or other degrees.",
  },
  {
    id: "electricity_bill",
    label: "Electricity bill",
    section: "address",
    sectionLabel: "Address proof",
    maxFiles: 1,
    minFiles: 0,
    oneOfGroup: "address_proof",
  },
  {
    id: "rent_agreement",
    label: "Rent / lease agreement",
    section: "address",
    sectionLabel: "Address proof",
    maxFiles: 1,
    minFiles: 0,
    oneOfGroup: "address_proof",
  },
  {
    id: "prev_appointment_letter",
    label: "Appointment letter",
    section: "previous_employer",
    sectionLabel: "Previous company",
    maxFiles: 1,
    minFiles: 1,
    helpText: "Upload documents for your most recent employer. For earlier roles, use Other previous employers below.",
  },
  {
    id: "prev_relieving_letter",
    label: "Relieving letter",
    section: "previous_employer",
    sectionLabel: "Previous company",
    maxFiles: 1,
    minFiles: 1,
  },
  {
    id: "prev_promotion_letter",
    label: "Promotion letter",
    section: "previous_employer",
    sectionLabel: "Previous company",
    maxFiles: 1,
    minFiles: 1,
  },
  {
    id: "prev_increment_letter",
    label: "Increment letter",
    section: "previous_employer",
    sectionLabel: "Previous company",
    maxFiles: 1,
    minFiles: 1,
  },
  {
    id: "salary_slip",
    label: "Salary slip (last 3 months)",
    section: "previous_employer",
    sectionLabel: "Previous company",
    maxFiles: 3,
    minFiles: 3,
    slotLabels: ["Month 1 (most recent)", "Month 2", "Month 3"],
  },
  {
    id: "cancelled_cheque",
    label: "Cancelled cheque",
    section: "bank",
    sectionLabel: "Bank proof",
    maxFiles: 1,
    minFiles: 0,
    oneOfGroup: "bank_proof",
  },
  {
    id: "passbook",
    label: "Passbook (first page)",
    section: "bank",
    sectionLabel: "Bank proof",
    maxFiles: 1,
    minFiles: 0,
    oneOfGroup: "bank_proof",
  },
];

export function specForType(documentType: string): DocumentTypeSpec | undefined {
  return DOCUMENT_TYPE_SPECS.find((s) => s.id === documentType);
}

export type UploadedDocRef = {
  documentType: string;
  slot: number;
};

export type StoredUploadRow = {
  id: number;
  document_type: string;
  slot: number;
  file_name: string;
  mime_type: string;
  file_size: number;
  uploaded_at: string;
};

export function completionForUploads(uploads: StoredUploadRow[]): {
  complete: boolean;
  uploadedCount: number;
  requiredCount: number;
  missingLabels: string[];
} {
  const byType = new Map<string, StoredUploadRow[]>();
  for (const u of uploads) {
    const list = byType.get(u.document_type) ?? [];
    list.push(u);
    byType.set(u.document_type, list);
  }

  const missingLabels: string[] = [];
  let requiredCount = 0;
  let uploadedCount = 0;

  const groupsDone = new Map<string, boolean>();

  for (const spec of DOCUMENT_TYPE_SPECS) {
    if (spec.id === "education") {
      const edu = byType.get("education") ?? [];
      const slotSet = new Set(edu.map((u) => u.slot));
      requiredCount += 2;
      if (slotSet.has(0)) uploadedCount += 1;
      else missingLabels.push("10th certificate");
      if (slotSet.has(1)) uploadedCount += 1;
      else missingLabels.push("12th certificate");
      continue;
    }

    if (spec.oneOfGroup) {
      if (groupsDone.has(spec.oneOfGroup)) continue;
      groupsDone.set(spec.oneOfGroup, false);
      const groupSpecs = DOCUMENT_TYPE_SPECS.filter((s) => s.oneOfGroup === spec.oneOfGroup);
      requiredCount += 1;
      const groupOk = groupSpecs.some((g) => (byType.get(g.id)?.length ?? 0) > 0);
      if (groupOk) {
        uploadedCount += 1;
        groupsDone.set(spec.oneOfGroup, true);
      } else {
        if (spec.oneOfGroup === "address_proof") {
          missingLabels.push("Electricity bill or rent agreement");
        } else if (spec.oneOfGroup === "bank_proof") {
          missingLabels.push("Cancelled cheque or passbook (first page)");
        }
      }
      continue;
    }

    const count = byType.get(spec.id)?.length ?? 0;
    requiredCount += spec.minFiles;
    uploadedCount += Math.min(count, spec.minFiles);
    if (count < spec.minFiles) {
      if (spec.minFiles === 3 && spec.id === "salary_slip") {
        missingLabels.push(`Salary slips (${count}/3 uploaded)`);
      } else if (spec.minFiles > 1) {
        missingLabels.push(`${spec.label} (${count}/${spec.minFiles})`);
      } else {
        missingLabels.push(spec.label);
      }
    }
  }

  return {
    complete: missingLabels.length === 0,
    uploadedCount,
    requiredCount,
    missingLabels,
  };
}
