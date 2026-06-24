# Service-layer patterns

`better-drizzle` works best when the service layer stays thin and explicit.

## A good service shape

```ts
export async function getUserProfile(userId: number) {
	return client.users.findUnique({
		include: {
			posts: {
				select: {
					id: true,
					title: true,
					published: true,
				},
			},
		},
		where: { id: userId },
	});
}
```

## A good write flow

```ts
export async function renameUser(userId: number, name: string) {
	return client.users.update({
		data: { name },
		where: { id: userId },
	}).throw(() => new Error('User not found'));
}
```

## A good transactional service

```ts
export async function createUserAndDraft(input: {
	email: string;
	name: string;
	title: string;
}) {
	return client.transaction(async (tx) => {
		const user = await tx.users.create({
			data: {
				email: input.email,
				name: input.name,
				active: true,
			},
		});

		return tx.posts.create({
			data: {
				authorId: user.id,
				title: input.title,
				published: false,
			},
		});
	});
}
```

## What to avoid

- wrapping every delegate call in another helper without adding real value
- hiding query shape so far away that callers cannot see payload cost
- rebuilding pagination, relation loading, or not-found behavior manually in every service
