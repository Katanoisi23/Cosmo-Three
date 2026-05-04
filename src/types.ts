export type Gender = 'male' | 'female' | 'other';

export interface FamilyMember {
  id: string;
  firstName: string;
  lastName?: string;
  birthDate?: string;
  deathDate?: string;
  gender: Gender;
  fatherId?: string;
  motherId?: string;
  spouseId?: string;
  photoUrl?: string;
  bio?: string;
  uid: string;
  createdAt: any; // Firestore Timestamp
}

export interface TreeData {
  id: string;
  name: string;
  gender: Gender;
  children?: TreeData[];
  spouse?: TreeData;
  member: FamilyMember;
}
