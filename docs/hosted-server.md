# Hosted server: OAuth and protocol details

For developers of MCP clients that connect to Meshy's hosted MCP server. To connect an existing client, see [Hosted server](../README.md#hosted-server) in the README.

The hosted server follows the [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization): OAuth 2.1 with discovery, PKCE and resource indicators. Users sign in with their Meshy account; clients are public clients with no secret.

## Endpoints

Clients find these endpoints through [discovery](#discovery); do not hard-code them. The table shows today's values, for reference:

| | Global | China |
|---|---|---|
| MCP server (the resource) | `https://mcp.meshy.ai/mcp` | `https://mcp.meshy.cn/mcp` |
| Protected resource metadata | `https://mcp.meshy.ai/.well-known/oauth-protected-resource/mcp` | `https://mcp.meshy.cn/.well-known/oauth-protected-resource/mcp` |
| Authorization server (issuer) | `https://api.meshy.ai` | `https://api.meshy.cn` |
| Authorization server metadata | `https://api.meshy.ai/.well-known/oauth-authorization-server` | `https://api.meshy.cn/.well-known/oauth-authorization-server` |
| Authorization endpoint | `https://www.meshy.ai/oauth/authorize` | `https://meshy.cn/oauth/authorize` |
| Token endpoint | `https://api.meshy.ai/openapi/oauth/token` | `https://api.meshy.cn/openapi/oauth/token` |
| Registration endpoint | `https://api.meshy.ai/openapi/oauth/register` | `https://api.meshy.cn/openapi/oauth/register` |
| Revocation endpoint | `https://api.meshy.ai/openapi/oauth/revoke` | `https://api.meshy.cn/openapi/oauth/revoke` |

Each region has its own issuer, and a token issued by one region is refused by the other.

## Transport

The server speaks Streamable HTTP, stateless, with JSON responses. Each MCP message is one `POST` to the server URL, answered with `application/json`. There is no session ID and no SSE stream to keep open. Every request carries its own credential:

```
Authorization: Bearer <access token>
```

## Discovery

1. A request without a credential gets `401` with
   `WWW-Authenticate: Bearer resource_metadata="https://mcp.meshy.ai/.well-known/oauth-protected-resource/mcp"`.
   A token the server refuses (expired, revoked, or not issued for this server) gets the same challenge with `error="invalid_token"`.
2. The protected resource metadata ([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)) names the `resource` and its `authorization_servers`.
3. The authorization server metadata ([RFC 8414](https://www.rfc-editor.org/rfc/rfc8414)) lists the endpoints and what they support: `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]`, `authorization_response_iss_parameter_supported: true` and `client_id_metadata_document_supported: true`. Its `scopes_supported` are OpenID Connect's `openid`, `email` and `profile`.

## Client registration

A client gets a `client_id` in one of two ways. Either way it is a public client: it holds no secret, and the token endpoint takes no client authentication.

### Dynamic client registration

`POST` a JSON body to the registration endpoint ([RFC 7591](https://www.rfc-editor.org/rfc/rfc7591)):

```json
{
  "client_name": "Example Client",
  "redirect_uris": ["http://127.0.0.1/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

| Field | Rule |
|---|---|
| `redirect_uris` | Required. At most 5, each at most 512 bytes, with no fragment, wildcard or white space. See [Callbacks](#callbacks). |
| `client_name` | At most 100 characters. The names of Meshy and of Meshy's own apps are reserved. |
| `client_uri`, `logo_uri` | Optional, `https` URLs. |
| `grant_types` | `authorization_code` and `refresh_token` only. A registered client gets both. |
| `response_types` | `code`, the default. |
| `token_endpoint_auth_method` | `none`, the default. Any other value is refused. |

Other fields are ignored. Registrations are rate-limited per source address. On the consent page, Meshy marks a registered client as one it has not reviewed.

A registered client that is never used is deleted an hour after it registers, and one that was used, 30 days after its last use. Its `client_id` then gets `invalid_client`: on that error, register again.

#### Callbacks

- **Loopback** callbacks are always accepted: `http://127.0.0.1`, `http://[::1]` or `http://localhost`, with any port and path. At authorization the port may differ from the registered one ([RFC 8252 §7.3](https://www.rfc-editor.org/rfc/rfc8252#section-7.3)); the rest must match exactly.
- **Any other callback**, `https` or a private-use scheme, is accepted only when Meshy has allowed that callback, matched exactly as written, or, for an `https` callback, its domain.
- A callback that is not accepted is dropped from the registration. The registration fails with `invalid_redirect_uri` only when none is left, so **use the `redirect_uris` in the response**, not the ones you sent.

### Client ID metadata documents

The `client_id` can also be the `https` URL of a client ID metadata document ([draft-ietf-oauth-client-id-metadata-document](https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/)). Meshy accepts these only from hosts it has admitted. A `client_id` URL on any other host fails at the authorization endpoint with `invalid_client`, and Meshy does not fall back to registration for it: such a client registers dynamically instead.

An admitted document must:

- give a `client_id` equal to its own URL, byte for byte;
- list callbacks that are loopback, or `https` on the document's own host;
- describe a public client (`token_endpoint_auth_method` `none`), with no `client_secret`.

Meshy fetches the document when a user starts an authorization and its stored copy has expired: a `GET` with `Accept: application/json`, a 3-second timeout, at most 16 KB, and no redirects followed. The copy is kept as long as the document's `Cache-Control` says, between 5 minutes and 24 hours.

## Authorization

Use the authorization code flow with PKCE:

| Parameter | Value |
|---|---|
| `response_type` | `code` |
| `client_id` | Your client's ID. |
| `redirect_uri` | One of the client's callbacks. |
| `code_challenge`, `code_challenge_method` | Required. `S256` only. |
| `resource` | The MCP server URL, for example `https://mcp.meshy.ai/mcp` ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)). Another resource is refused with `invalid_target`. |
| `state` | Recommended. |
| `scope`, `nonce`, `prompt` | Optional, for OpenID Connect. `prompt` takes `none`, `login`, `consent` or `select_account`. |

The user signs in to Meshy and approves the client. An unknown client or a callback the client does not have gets an error page, never a redirect. Once both are trusted, every response goes to the callback and carries `iss` ([RFC 9207](https://www.rfc-editor.org/rfc/rfc9207)): check that it equals the issuer.

## Tokens

### Code exchange

`POST` a form (`application/x-www-form-urlencoded`) to the token endpoint:

```
grant_type=authorization_code
&code=<code>
&redirect_uri=<the same redirect_uri>
&client_id=<client_id>
&code_verifier=<verifier>
&resource=https://mcp.meshy.ai/mcp
```

The response carries `access_token` (type `Bearer`), `expires_in` and `refresh_token`, and an `id_token` when `openid` was requested.

The access token is for the MCP server only. Meshy's REST API refuses it.

### Refresh

```
grant_type=refresh_token
&refresh_token=<refresh token>
&client_id=<client_id>
```

- **Refresh tokens rotate.** Each refresh returns a new refresh token, and the old one stops working. Store the new one before using the new access token.
- **Refresh one at a time.** When two refreshes race with the same token, one succeeds and the other gets `invalid_grant`.
- **Never reuse an old refresh token.** Within 30 seconds of its rotation, reuse gets `invalid_grant`. Later, Meshy treats it as stolen and revokes the whole authorization: the user signs in again.
- A refresh token expires after 30 days without a refresh. The user then signs in again.
- Refresh when `expires_in` has passed, or when the MCP server answers `401` with `error="invalid_token"`.

### Revocation

`POST` a form to the revocation endpoint ([RFC 7009](https://www.rfc-editor.org/rfc/rfc7009)) with `token` and `client_id`:

- Any token of an authorization, access or refresh, revokes the whole authorization: it signs the client out. The refresh token stops at once. An access token already issued keeps working until it expires, at most 15 minutes.
- A token that no longer works (unknown, expired or already revoked) gets `200`, and nothing changes.
- A valid token of another client gets `400 invalid_grant`.
- `503` with `Retry-After` means the check could not run. The token may still be valid: retry.

Users can also revoke a client under **Settings → Profile → Authorized apps** on the site they signed in on.

## Calling the server

- Send the bearer on every request.
- `401` with `error="invalid_token"`: refresh and retry once. If the refresh fails, sign the user in again.
- `503` with `Retry-After`: Meshy could not check the credential just then. Retry; do not discard the tokens.
- Create tools take a `request_id`. Use a new random UUID for each generation the user asks for, and the same one only to retry that call: for 30 days a retry answers from the first call and never creates or charges a second task.
- A tool that refuses a call answers with a tool result marked as an error, whose message says why.

## API keys

A client can send a Meshy API key in place of an access token, `Authorization: Bearer msy_...`. Users create keys in the [Developer Console](https://www.meshy.ai/developers/keys).

- A key with an IP allowlist is refused with `403` and `{"error": "ip_not_authorized"}`.
- Each key can make 20 requests per second. Over that the server answers `429` with `{"error": "rate_limit_exceeded"}` and `Retry-After`.
- Neither answer carries a `WWW-Authenticate` challenge: the key itself is valid, so do not start an OAuth sign-in.

## Rate limits

The token, registration and revocation endpoints are rate-limited, by source address among other things. A limit answers `429`, and a limiter that could not run answers `503` with `Retry-After`. A service whose servers make these requests for many users shares one address's allowance among them.
