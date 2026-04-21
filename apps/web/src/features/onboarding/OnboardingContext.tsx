"use client";

import { createContext, useContext } from "react";

type OnboardingContextValue = {
  openEditDialog: () => void;
};

const OnboardingContext = createContext<OnboardingContextValue>({
  openEditDialog: () => {},
});

export const OnboardingProvider = OnboardingContext.Provider;
export const useOnboarding = () => useContext(OnboardingContext);
