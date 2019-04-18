# Rollbar on GraphQL

GraphQL wrapper around the read endpoints of the Rollbar REST API.

Not intended for real use, just an example.

* `yarn install`
* `VERBOSE=true yarn start`
* Go to `localhost:4000` in your browser

To get access to data you need to provide an account and/or project access token.
You can put these in a .env file where you run the server with:

```
ACCOUNT_TOKEN=xxx
PROJECT_TOKEN=yyy
```

Or you can set them per request with the http headers in the GraphQL explorer:

```
{"x-account-token":"xxx","x-project-token":"yyy"}
```
