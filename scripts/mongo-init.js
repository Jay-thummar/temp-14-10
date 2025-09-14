// MongoDB initialization script
db = db.getSiblingDB('shopcompare');

// Create collections with validation
db.createCollection('users', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['name', 'email'],
      properties: {
        name: { bsonType: 'string' },
        email: { bsonType: 'string' },
        phone: { bsonType: 'string' },
        passwordHash: { bsonType: 'string' },
        googleId: { bsonType: 'string' },
        roles: { bsonType: 'array' },
        isActive: { bsonType: 'bool' },
        emailVerified: { bsonType: 'bool' },
        phoneVerified: { bsonType: 'bool' },
      }
    }
  }
});

db.createCollection('productmasters', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['canonicalTitle', 'brand', 'category'],
      properties: {
        canonicalTitle: { bsonType: 'string' },
        brand: { bsonType: 'string' },
        category: { bsonType: 'string' },
        description: { bsonType: 'string' },
        images: { bsonType: 'array' },
        isActive: { bsonType: 'bool' },
      }
    }
  }
});

db.createCollection('platformitems', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['productMasterId', 'platform', 'platformSku', 'title', 'price'],
      properties: {
        productMasterId: { bsonType: 'objectId' },
        platform: { bsonType: 'string' },
        platformSku: { bsonType: 'string' },
        title: { bsonType: 'string' },
        price: { bsonType: 'number' },
        currency: { bsonType: 'string' },
        isActive: { bsonType: 'bool' },
      }
    }
  }
});

// Create indexes
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ googleId: 1 }, { unique: true, sparse: true });
db.users.createIndex({ phone: 1 }, { unique: true, sparse: true });

db.productmasters.createIndex({ canonicalTitle: 'text', brand: 'text', description: 'text' });
db.productmasters.createIndex({ brand: 1 });
db.productmasters.createIndex({ category: 1, subcategory: 1 });
db.productmasters.createIndex({ isActive: 1 });

db.platformitems.createIndex({ platform: 1, platformSku: 1 }, { unique: true });
db.platformitems.createIndex({ productMasterId: 1, platform: 1 });
db.platformitems.createIndex({ platform: 1, price: 1 });
db.platformitems.createIndex({ isActive: 1 });

db.pricehistories.createIndex({ platformItemId: 1, timestamp: -1 });
db.pricehistories.createIndex({ productMasterId: 1, platform: 1, timestamp: -1 });
db.pricehistories.createIndex({ timestamp: 1 }, { expireAfterSeconds: 31536000 }); // 1 year TTL

db.watchlists.createIndex({ userId: 1, productMasterId: 1 }, { unique: true });
db.watchlists.createIndex({ userId: 1, isEnabled: 1 });

db.searchlogs.createIndex({ timestamp: -1 });
db.searchlogs.createIndex({ userId: 1, timestamp: -1 });
db.searchlogs.createIndex({ normalizedQuery: 1, timestamp: -1 });
db.searchlogs.createIndex({ timestamp: 1 }, { expireAfterSeconds: 7776000 }); // 3 months TTL

db.spendrecords.createIndex({ userId: 1, orderDate: -1 });
db.spendrecords.createIndex({ userId: 1, platform: 1, orderDate: -1 });

db.jobs.createIndex({ status: 1, priority: -1, createdAt: 1 });
db.jobs.createIndex({ type: 1, status: 1 });
db.jobs.createIndex({ nextRunAt: 1, status: 1 });

db.coupons.createIndex({ platform: 1, code: 1 }, { unique: true });
db.coupons.createIndex({ platform: 1, isActive: 1, validTill: -1 });
db.coupons.createIndex({ validFrom: 1, validTill: 1 });

print('Database initialized successfully with collections and indexes');