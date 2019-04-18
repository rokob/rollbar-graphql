require('dotenv').config()

const { GraphQLServer } = require('graphql-yoga')
const fetch = require('node-fetch')
const GraphQLJSON = require('graphql-type-json');

const ACCOUNT_TOKEN = process.env.ACCOUNT_TOKEN
const PROJECT_TOKEN = process.env.PROJECT_TOKEN
const BASE_URL = "https://api.rollbar.com/api/1/"

const VERBOSE = process.env.VERBOSE
const CACHE = process.env.CACHE

const typeDefs = `
  type User {
    id: Int!
    username: String!
    email: String!
    email_enabled: Int
    teams: [Team!]
    projects: [Project!]
  }

  type Team {
    id: Int!
    account_id: Int!
    name: String!
    access_level: AccessLevel!
    users: [User!]
    projects: [Project!]
  }

  type Project {
    id: Int!
    account_id: Int!
    status: String
    name: String
    slug: String
  }

  type Item {
    id: Int!
    controlling_id: Int
    project_id: Int
    hash: String
    title: String
    environment: String
    level: Level
    counter: Int
    framework: String
    platform: String
    status: Status
    last_activated_timestamp: Int
    assigned_user_id: Int
    group_status: Int
    last_occurrence_id: Int
    last_occurrence_timestamp: Int
    first_occurrence_timestamp: Int
    total_occurrences: Int
    unique_occurrences: Int
    group_item_id: Int
    last_modified_by: Int
    first_occurrence_id: Int
    activating_occurrence_id: Int
    occurrences(
      "Page number starting at 1. 20 occurrences are returned per page"
      page: Int
    ): [Occurrence!]
  }

  type Occurrence {
    id: String!
    project_id: Int!
    timestamp: Int
    version: Int
    billable: Int
    data: OccurrenceData
  }

  type OccurrenceData {
    uuid: String
    level: Level
    environment: String
    notifier: Notifier
    metadata: JSON
    timestamp: Int
    server: JSON
    framework: String
    body: JSON
    language: String
  }

  type Notifier {
    version: String
    name: String
  }

  type RqlJob {
    id: Int!
    status: RqlStatus!
    date_modified: Int
    job_hash: String
    query_string: String
    date_created: Int
    project: Project
    result: RqlResult
  }

  type RqlResult {
    isSimpleSelect: Boolean
    errors: [String]
    warnings: [String]
    executionTime: Float
    effectiveTimestamp: Int
    rowcount: Int
    rows: [[String]]
    selectionColumns: [String]
    columns: [String]
  }

  type Query {
    users(first: Int, skip: Int): [User!]!
    user(id: Int!): User
    teams(first: Int, skip: Int): [Team!]!
    team(id: Int!): Team
    projects(first: Int, skip: Int): [Project!]!
    project(id: Int!): Project
    items(
      "Only items assigned to the specified user will be returned. Must be a valid Rollbar username, or you can use the keywords 'assigned' (items that are assigned to any owner) or 'unassigned' (items with no owner)."
      assigned_user: String

      "Only items in the specified environments will be returned."
      environment: [String]

      "Only items in the specified frameworks will be returned."
      framework: [String]

      "List of item IDs to return, instead of using all items in the project."
      ids: [Int]

      "Only items with the specified levels will be returned."
      level: [Level]

      "Page number, starting from 1. 100 items are returned per page."
      page: Int

      "A search string, using the same format as the search box on the Items page."
      query: String

      "Only items with the specified status will be returned."
      status: [Status]
    ): [Item!]

    "Get an item. One of id or counter must be specified"
    item(
      "ID as returned in the id field in other API calls. Note that this is NOT found in an URL"
      id: Int
      "Item counter for an item in the project. The counter can be found in URLs"
      counter: Int
    ): Item
    occurrences(
      "Page number starting at 1. 20 occurrences are returned per page"
      page: Int
    ): [Occurrence!]
    occurrence(id: String!): Occurrence
    rql_jobs(page: Int): [RqlJob!]
    rql_job(id: Int!): RqlJob
  }

  enum AccessLevel {
    "standard is the only access level you can choose in the UI"
    standard
    "view gives the team read-only access"
    view
    "light gives the team read and write access, but not to all settings"
    light
    "everyone is not in the spec"
    everyone
    "owner is not in the spec"
    owner
  }

  enum Level {
    debug
    info
    warning
    error
    critical
  }

  enum Status {
    active
    resolved
    muted
    archived
  }

  enum RqlStatus {
    new
    running
    success
    failed
    cancelled
    timed_out
    deleted
  }

  scalar JSON
`

const resolvers = {
  Query: {
    users: (_p, args, ctx) => trunc(args, maybeGet(buildAccountUrl(ctx, 'users'), 'users', (u) => u.username && u.email)),
    user: (_, { id }, ctx) => maybeGet(buildAccountUrl(ctx, `user/${id}`)),
    teams: (_p, args, ctx) => trunc(args, maybeGet(buildAccountUrl(ctx, 'teams'))),
    team: (_, { id }, ctx) => maybeGet(buildAccountUrl(ctx, `team/${id}`)),
    projects: (_p, args, ctx) => trunc(args, maybeGet(buildAccountUrl(ctx, 'projects'), undefined, (p) => p.status)),
    project: (_, { id }, ctx) => maybeGet(buildAccountUrl(ctx, `project/${id}`)),
    items: (_, args, ctx) => getItems(ctx, args),
    item: (_, { id, counter }, ctx) => {
      if (!id && !counter) {
        throw new Error('Must specify id or counter');
      }
      if (id) {
        return maybeGet(buildProjectUrl(ctx, `item/${id}`));
      }
      return maybeGet(buildProjectUrl(ctx, `item_by_counter/${counter}`));
    },
    occurrences: (_, { page }, ctx) => {
      let query = page ? `page=${page}` : undefined;
      return maybeGet(buildProjectUrl(ctx, 'instances', query), 'instances');
    },
    occurrence: (_, { id }, ctx) => maybeGet(buildProjectUrl(ctx, `instance/${id}`)),
    rql_jobs: (_, { page }, ctx) => {
      let query = page ? `page=${page}` : undefined;
      return maybeGet(buildProjectUrl(ctx, 'rql/jobs', query), 'jobs');
    },
    rql_job: (_, { id }, ctx) => maybeGet(buildProjectUrl(ctx, `rql/job/${id}`, 'expand=result')),
  },
  Item: {
    occurrences: ({ id }, { page }, ctx) => {
      let query = page ? `page=${page}` : undefined;
      return maybeGet(buildProjectUrl(ctx, `item/${id}/instances`, query), 'instances');
    },
  },
  RqlJob: {
    project: ({ project_id }, _, ctx) => maybeGet(buildAccountUrl(ctx, `project/${project_id}`)),
    result: ({ id, result }, _, ctx) => {
      if (result) {
        return result;
      }
      return maybeGet(buildProjectUrl(ctx, `rql/job/${id}/result`), 'result');
    },
  },
  User: {
    teams: ({ id }, _, ctx) => maybeGet(buildAccountUrl(ctx, `user/${id}/teams`), 'teams'),
    projects: ({ id }, _, ctx) => maybeGet(buildAccountUrl(ctx, `user/${id}/projects`), 'projects'),
  },
  Team: {
    users: ({ id }, _, ctx) => {
      return maybeGet(buildAccountUrl(ctx, `team/${id}/users`, 'page=1'))
      .then(data => {
        if (!data) {
          return data;
        }
        return Promise.all(data.map(({ user_id }) => maybeGet(buildAccountUrl(ctx, `user/${user_id}`))));
      })
    },
    projects: ({ id }, _, ctx) => {
      return maybeGet(buildAccountUrl(ctx, `team/${id}/projects`))
      .then(data => {
        if (!data) {
          return data;
        }
        return Promise.all(data.map(({ project_id }) => maybeGet(buildAccountUrl(ctx, `project/${project_id}`))));
      })
    },
  },
  JSON: GraphQLJSON,
}

function buildAccountUrl(ctx, endpoint, query) {
  query = query ? `&${query}` : ''
  return `${BASE_URL}${endpoint}?access_token=${ctx.accountToken}${query}`
}

function buildProjectUrl(ctx, endpoint, query) {
  query = query ? `&${query}` : ''
  return `${BASE_URL}${endpoint}?access_token=${ctx.projectToken}${query}`
}

function niceUrl(url) {
  let parts = url.split('?');
  if (parts[1].length > 46) {
    return [parts[0].substr(BASE_URL.length-1), parts[1].substr(46)].join('?');
  }
  return parts[0].substr(BASE_URL.length-1);
}

let cache = {}

function maybeGet(url, path, filter) {
  if (CACHE && cache[[url, path]]) {
    if (VERBOSE) {
      console.log("GET (cached): ", niceUrl(url));
    }
    return cache[[url, path]];
  } else {
    if (VERBOSE) {
      console.log("GET: ", niceUrl(url));
    }
  }
  let p = fetch(url)
    .then(res => res.json())
    .then(data => {
      if (data.err) {
        console.error(data);
        return null;
      }
      if (!path) {
        if (!filter) {
          return data.result;
        }
        return data.result.filter(filter);
      }
      let result = path
        .split('.')
        .reduce((a, p) => (a && a[p]), data.result);
      if (!filter || !result) {
        return result;
      }
      return result.filter(filter);
    });
  if (CACHE) {
    cache[[url, path]] = p;
  }
  return p;
}

function getItems(ctx, args) {
  let qs = [];
  const { assigned_user, page, query, environment, framework, ids, level, status } = args;
  if (assigned_user) {
    qs.push(`assigned_user=${assigned_user}`);
  }
  if (page) {
    qs.push(`page=${page}`);
  }
  if (query) {
    qs.push(`query=${query}`);
  }
  if (environment) {
    environment.forEach(e => qs.push(`environment=${e}`));
  }
  if (framework) {
    framework.forEach(e => qs.push(`framework=${e}`));
  }
  if (ids) {
    ids.forEach(e => qs.push(`ids=${e}`));
  }
  if (level) {
    level.forEach(e => qs.push(`level=${e}`));
  }
  if (status) {
    status.forEach(e => qs.push(`status=${e}`));
  }
  qs = qs ? qs.join('&') : undefined;
  return maybeGet(buildProjectUrl(ctx, 'items', qs), 'items');
}

function trunc({ first, skip }, promise) {
  if (!promise) {
    return promise;
  }
  return promise.then(data => {
    if (!data) {
      return data;
    }
    if (first == null && skip == null) {
      return data;
    }
    if (first == null) {
      return data.slice(skip + 1);
    }
    skip = skip || -1;
    return data.slice(skip + 1, skip + 1 + first);
  })
}

function contextFn({ request, response, connection }) {
  let ctx = {accountToken: ACCOUNT_TOKEN, projectToken: PROJECT_TOKEN}
  let { headers } = request;
  if (!headers) {
    return ctx;
  }
  ctx.accountToken = headers['x-account-token'] || ctx.accountToken;
  ctx.projectToken = headers['x-project-token'] || ctx.projectToken;
  return ctx;
}

const server = new GraphQLServer({ typeDefs, resolvers, context: contextFn})
const options = {
  port: 4000,
  tracing: true,
}
server.start(options, ({ port }) => console.log(`Server is running on localhost:${port}`))
