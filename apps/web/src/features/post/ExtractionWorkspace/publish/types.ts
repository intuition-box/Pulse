import type { Address, PublicClient, WalletClient } from "viem";
import type { Stance } from "../extraction";

export type OnchainWriteConfig = {
  walletClient: WalletClient;
  publicClient: PublicClient;
  multivaultAddress: Address;
};

export type PublishContext = {
  writeConfig: OnchainWriteConfig;
  accountAddress: Address;
};

export type StanceEntry = {
  mainTripleTermId: string;
  mainProposalId: string;
  stance: Stance;
  parentMainTripleTermId: string;
};

export type TagEntry = {
  mainTripleTermId: string;
  mainProposalId: string;
  themeAtomTermId: string;
};
