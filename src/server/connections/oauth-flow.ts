import { randomBytes } from "node:crypto";
import type {
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

interface PendingAuthorization {
  connectionId: string;
  transport: StreamableHTTPClientTransport;
  resolve: () => void;
  reject: (error: unknown) => void;
  expiresAt: number;
}

interface CredentialState {
  clients: Map<string, StoredOAuthClientInformation>;
  tokens: Map<string, StoredOAuthTokens>;
  latestTokens?: StoredOAuthTokens;
  verifier?: string;
  discovery?: OAuthDiscoveryState;
}

export class OAuthCallbackError extends Error {
  constructor(message = "OAuth authorization could not be completed") {
    super(message);
    this.name = "OAuthCallbackError";
  }
}

export class OAuthFlowCoordinator {
  private readonly credentials = new Map<string, CredentialState>();
  private readonly pending = new Map<string, PendingAuthorization>();

  constructor(private readonly options: {
    redirectUrl: () => string;
    openAuthorizationUrl: (url: string) => void | Promise<void>;
    now?: () => number;
  }) {}

  provider(connectionId: string, attachTransport: (provider: OAuthClientProvider) => StreamableHTTPClientTransport): OAuthClientProvider {
    const state: CredentialState = this.credentials.get(connectionId) ?? { clients: new Map(), tokens: new Map() };
    this.credentials.set(connectionId, state);
    let authorizationState = "";
    const provider: OAuthClientProvider = {
      get redirectUrl() { return new URL(thisCoordinator.options.redirectUrl()); },
      get clientMetadata(): OAuthClientMetadata {
        return {
          client_name: "MCP Inspector",
          redirect_uris: [thisCoordinator.options.redirectUrl()],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        };
      },
      state() {
        authorizationState = randomBytes(32).toString("base64url");
        return authorizationState;
      },
      clientInformation(context) { return context === undefined ? undefined : state.clients.get(context.issuer); },
      saveClientInformation(value, context) {
        if (context !== undefined) state.clients.set(context.issuer, value);
      },
      tokens(context) { return context === undefined ? state.latestTokens : state.tokens.get(context.issuer); },
      saveTokens(value, context) {
        state.latestTokens = value;
        if (context !== undefined) state.tokens.set(context.issuer, value);
      },
      async redirectToAuthorization(url) {
        if (authorizationState.length === 0) throw new OAuthCallbackError();
        const transport = attachTransport(provider);
        const completion = new Promise<void>((resolve, reject) => {
          thisCoordinator.pending.set(authorizationState, {
            connectionId, transport, resolve, reject,
            expiresAt: (thisCoordinator.options.now?.() ?? Date.now()) + 10 * 60_000,
          });
        });
        try {
          await thisCoordinator.options.openAuthorizationUrl(url.toString());
          await completion;
        } catch (error) {
          thisCoordinator.pending.delete(authorizationState);
          throw error;
        }
      },
      saveCodeVerifier(value) { state.verifier = value; },
      codeVerifier() {
        if (state.verifier === undefined) throw new OAuthCallbackError();
        return state.verifier;
      },
      invalidateCredentials(scope) {
        if (scope === "all" || scope === "tokens") { state.tokens.clear(); state.latestTokens = undefined; }
        if (scope === "all" || scope === "client") state.clients.clear();
        if (scope === "all" || scope === "verifier") state.verifier = undefined;
        if (scope === "all" || scope === "discovery") state.discovery = undefined;
      },
      saveDiscoveryState(value) { state.discovery = value; },
      discoveryState() { return state.discovery; },
    };
    const thisCoordinator = this;
    return provider;
  }

  async complete(params: URLSearchParams): Promise<string> {
    const state = params.get("state");
    if (state === null || state.length > 256) throw new OAuthCallbackError();
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (pending === undefined) {
      throw new OAuthCallbackError("OAuth authorization expired or is invalid");
    }
    if (pending.expiresAt < (this.options.now?.() ?? Date.now())) {
      const error = new OAuthCallbackError("OAuth authorization expired or is invalid");
      pending.reject(error);
      throw error;
    }
    try {
      await pending.transport.finishAuth(params);
      pending.resolve();
      return pending.connectionId;
    } catch (error) {
      pending.reject(error);
      throw new OAuthCallbackError();
    }
  }

  clear(connectionId: string): void {
    this.credentials.delete(connectionId);
    for (const [state, pending] of this.pending) {
      if (pending.connectionId === connectionId) {
        this.pending.delete(state);
        pending.reject(new OAuthCallbackError("OAuth authorization was cancelled"));
      }
    }
  }
}
