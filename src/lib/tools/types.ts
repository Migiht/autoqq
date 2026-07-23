export interface ToolDefinition {
  id: string;
  displayName: string;
  binary: string;
  installPackage: string;
  loginArgs: string[];
  pingArgs: (greeting: string) => string[];
  verifyAuth: () => Promise<boolean>;
}
