import { useContext } from 'react';
import { LargeScreenContext } from '../components/Context/LargeScreenProvider';

interface UseIsLargeScreenResult {
  isLargeScreen: boolean;
  setLargeScreenValue: React.Dispatch<React.SetStateAction<boolean | undefined>>;
}

export const useIsLargeScreen = (): UseIsLargeScreenResult => {
  const context = useContext(LargeScreenContext);
  if (context === undefined) {
    throw new Error('useIsLargeScreen must be used within a LargeScreenProvider');
  }
  return {
    isLargeScreen: context.isLargeScreen,
    setLargeScreenValue: context.setIsLargeScreen,
  };
};