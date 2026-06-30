/**
 * profileStore — the identity shown in the rail's account area.
 *
 * A solo user has a name + profile picture; a firm has a name + logo. Both the
 * name and the image are user-editable (the image is uploaded and stored as a
 * small data URL). Which identity is shown is decided by the firm session
 * (useFirm().isSignedIn) at the call site, not here. Persisted to localStorage.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SK_PROFILE } from '@/config/identity';

interface ProfileState {
  soloName: string;
  soloAvatar: string | null; // data URL
  firmName: string;
  firmLogo: string | null; // data URL
  setSoloName: (name: string) => void;
  setSoloAvatar: (dataUrl: string | null) => void;
  setFirmName: (name: string) => void;
  setFirmLogo: (dataUrl: string | null) => void;
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      soloName: '',
      soloAvatar: null,
      firmName: '',
      firmLogo: null,
      setSoloName: (soloName) => { set({ soloName }); },
      setSoloAvatar: (soloAvatar) => { set({ soloAvatar }); },
      setFirmName: (firmName) => { set({ firmName }); },
      setFirmLogo: (firmLogo) => { set({ firmLogo }); },
    }),
    { name: SK_PROFILE },
  ),
);
