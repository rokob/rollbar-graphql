const { GraphQLServer } = require('graphql-yoga')
const fetch = require('node-fetch')

const ACCOUNT_TOKEN = ""
const PROJECT_TOKEN = ""
const BASE_URL = "https://api.rollbar.com/api/1/"

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
    status: String!
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
    data: OccurrenceData
  }

  type OccurrenceData {
    uuid: String
    level: Level
    environment: String
    notifier: Notifier
  }

  type Notifier {
    version: String
    name: String
  }

  type Query {
    users: [User!]!
    user(id: Int!): User

    teams: [Team!]!
    team(id: Int!): Team

    projects: [Project!]!
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
`
const resolvers = {
  Query: {
    users: () => maybeGet(buildAccountUrl('users'), 'users', (u) => u.username && u.email),
    user: (_, { id }) => maybeGet(buildAccountUrl(`user/${id}`)),

    teams: () => maybeGet(buildAccountUrl('teams')),
    team: (_, { id }) => maybeGet(buildAccountUrl(`team/${id}`)),

    projects: () => maybeGet(buildAccountUrl('projects'), undefined, (p) => p.status),
    project: (_, { id }) => maybeGet(buildAccountUrl(`project/${id}`)),

    items: (_, args) => getItems(args),
    item: (_, { id, counter }) => {
      if (!id && !counter) {
        throw new Error('Must specify id or counter');
      }
      if (id) {
        return maybeGet(buildProjectUrl(`item/${id}`));
      }
      return maybeGet(buildProjectUrl(`item_by_counter/${counter}`));
    },
    occurrences: (_, { page }) => {
      let query = page ? `page=${page}` : undefined;
      return maybeGet(buildProjectUrl('instances', query), 'instances');
    },
    occurrence: (_, { id }) => maybeGet(buildProjectUrl(`instance/${id}`)),
  },

  Item: {
    occurrences: ({ id }, { page }) => {
      let query = page ? `page=${page}` : undefined;
      return maybeGet(buildProjectUrl(`item/${id}/instances`, query), 'instances');
    },
  },

  User: {
    teams: ({ id }) => maybeGet(buildAccountUrl(`user/${id}/teams`), 'teams'),
    projects: ({ id }) => maybeGet(buildAccountUrl(`user/${id}/projects`), 'projects'),
  },

  Team: {
    users: ({ id }) => {
      return maybeGet(buildAccountUrl(`team/${id}/users`, 'page=1'))
      .then(data => {
        if (!data) {
          return data;
        }
        return Promise.all(data.map(({ user_id }) => maybeGet(buildAccountUrl(`user/${user_id}`))));
      })
    },
    projects: ({ id }) => {
      return maybeGet(buildAccountUrl(`team/${id}/projects`))
      .then(data => {
        if (!data) {
          return data;
        }
        return Promise.all(data.map(({ project_id }) => maybeGet(buildAccountUrl(`project/${project_id}`))));
      })
    },
  },
}

function buildAccountUrl(endpoint, query) {
  query = query ? `&${query}` : ''
  return `${BASE_URL}${endpoint}?access_token=${ACCOUNT_TOKEN}${query}`
}

function buildProjectUrl(endpoint, query) {
  query = query ? `&${query}` : ''
  return `${BASE_URL}${endpoint}?access_token=${PROJECT_TOKEN}${query}`
}

function maybeGet(url, path, filter) {
  return fetch(url)
    .then(res => res.json())
    .then(data => {
      if (data.err) {
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
    })
}

function getItems(args) {
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
  return maybeGet(buildProjectUrl('items', qs), 'items');
}

const server = new GraphQLServer({ typeDefs, resolvers })
server.start(() => console.log('Server is running on localhost:4000'))
