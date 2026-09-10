const { CreateTableCommand, ResourceInUseException } = require('@aws-sdk/client-dynamodb');
const { client } = require('../client');

const tables = [
  {
    TableName: 'Users',
    KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'username', AttributeType: 'S' },
      { AttributeName: 'email', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'GSI-Username',
        KeySchema: [{ AttributeName: 'username', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'GSI-Email',
        KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    TableName: 'Projects',
    KeySchema: [{ AttributeName: 'projectId', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'projectId', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    TableName: 'Enrollments',
    KeySchema: [
      { AttributeName: 'userId', KeyType: 'HASH' },
      { AttributeName: 'projectId', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'projectId', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'GSI-Project',
        KeySchema: [
          { AttributeName: 'projectId', KeyType: 'HASH' },
          { AttributeName: 'userId', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    TableName: 'PullRequests',
    KeySchema: [{ AttributeName: 'prId', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'prId', AttributeType: 'S' },
      { AttributeName: 'authorUserId', AttributeType: 'S' },
      { AttributeName: 'reviewerUserId', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'GSI-Author',
        KeySchema: [{ AttributeName: 'authorUserId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'GSI-Reviewer',
        KeySchema: [{ AttributeName: 'reviewerUserId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    // sortKey stores "<createdAt ISO>#<commentId>" so a plain Query on prId
    // returns comments in chronological order for free.
    TableName: 'PrComments',
    KeySchema: [
      { AttributeName: 'prId', KeyType: 'HASH' },
      { AttributeName: 'sortKey', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'prId', AttributeType: 'S' },
      { AttributeName: 'sortKey', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    // same sortKey convention as PrComments: "<createdAt ISO>#<reviewId>"
    TableName: 'PrReviews',
    KeySchema: [
      { AttributeName: 'prId', KeyType: 'HASH' },
      { AttributeName: 'sortKey', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'prId', AttributeType: 'S' },
      { AttributeName: 'sortKey', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
];

async function createTables() {
  for (const table of tables) {
    try {
      await client.send(new CreateTableCommand(table));
      console.log(`Created table: ${table.TableName}`);
    } catch (err) {
      if (err instanceof ResourceInUseException) {
        console.log(`Table already exists, skipping: ${table.TableName}`);
      } else {
        throw err;
      }
    }
  }
}

createTables()
  .then(() => console.log('Done.'))
  .catch((err) => {
    console.error('Failed to create tables:', err);
    process.exit(1);
  });
