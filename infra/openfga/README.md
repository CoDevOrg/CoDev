# OpenFGA setup

CoDev keeps PostgreSQL membership rows as the durable source of truth and
mirrors each membership into OpenFGA as a workspace relationship. Configure
the OpenFGA endpoint, store, and authorization model in the server-only
Vercel environment:

```text
OPENFGA_API_URL=https://<your-openfga-endpoint>
OPENFGA_STORE_ID=<store id>
OPENFGA_AUTHORIZATION_MODEL_ID=<authorization model id>
OPENFGA_CLIENT_TOKEN=<optional client token>
```

For the hosted Auth0 FGA service, use client credentials instead of a
pre-shared client token:

```
OPENFGA_API_TOKEN_ISSUER=https://auth.fga.dev
OPENFGA_API_AUDIENCE=https://api.us1.fga.dev/
OPENFGA_CLIENT_ID=<client id>
OPENFGA_CLIENT_SECRET=<client secret>
```

CoDev exchanges the client credentials for a short-lived bearer token and
caches it in the server runtime. The client only needs tuple write/delete and
read/query permissions.

Create the store and publish the checked-in model before enabling those
variables. The API calls below use the OpenFGA HTTP API and work with a local
or hosted OpenFGA service:

```sh
OPENFGA_API_URL=https://<your-openfga-endpoint>

store_id="$(curl -fsS -X POST "${OPENFGA_API_URL}/stores" \
  -H 'content-type: application/json' \
  -d '{"name":"codev"}' | jq -r .id)"

model_payload="$(jq -n '{schema_version:"1.1",type_definitions:[
  {type:"user"},
  {type:"workspace",relations:{
    owner:{this:{}},
    editor:{union:{child:[{this:{}},{computedUserset:{relation:"owner"}}]}},
    reviewer:{union:{child:[{this:{}},{computedUserset:{relation:"editor"}}]}},
    viewer:{union:{child:[{this:{}},{computedUserset:{relation:"reviewer"}},{computedUserset:{relation:"viewer_from_link"}}]}},
    viewer_from_link:{this:{}}
  },metadata:{relations:{
    owner:{directly_related_user_types:[{type:"user"}]},
    editor:{directly_related_user_types:[{type:"user"}]},
    reviewer:{directly_related_user_types:[{type:"user"}]},
    viewer:{directly_related_user_types:[{type:"user"}]},
    viewer_from_link:{directly_related_user_types:[{type:"user"}]}
  }}}
]}' )"
model_id="$(curl -fsS -X POST \
  "${OPENFGA_API_URL}/stores/${store_id}/authorization-models" \
  -H 'content-type: application/json' \
  -d "${model_payload}" | jq -r .authorization_model_id)"
```

Set `OPENFGA_STORE_ID=${store_id}` and
`OPENFGA_AUTHORIZATION_MODEL_ID=${model_id}` in Vercel. The application fails
closed in production when these values are absent. If a membership predates
OpenFGA tuple writes, its first access repairs the derived tuple and rechecks
the authorization decision; a persistent denial remains forbidden.

The canonical relationship DSL is [`model.fga`](./model.fga).
