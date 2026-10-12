# Ticket 48 (spec 11, "Registry"; spec 12, "Tags"). The app image and the DB
# image (spec 13) are released independently, so each has its own
# repository, with identical settings. The ECR push role (bootstrap config)
# is scoped to exactly these names.
resource "aws_ecr_repository" "main" {
  for_each = toset(local.ecr_repositories)

  name = each.key

  # A published `sha-*` tag always means the same bytes; `main` moves to
  # the latest release.
  image_tag_mutability = "IMMUTABLE_WITH_EXCLUSION"
  image_tag_mutability_exclusion_filter {
    filter      = "main"
    filter_type = "WILDCARD"
  }
}

# Keep 50, not fewer: deploys are manual, so the running image can be many
# releases old, and ECR doesn't protect an image a running task uses (once
# its digest expires, a replacement task can't pull it). Expire, never
# archive: archived images can't be pulled. Signatures and SBOMs are OCI 1.1
# referrers, which ECR keeps while their image exists.
resource "aws_ecr_lifecycle_policy" "main" {
  for_each = aws_ecr_repository.main

  repository = each.value.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the last 50 sha-* images"
        selection = {
          tagStatus      = "tagged"
          tagPatternList = ["sha-*"]
          countType      = "imageCountMoreThan"
          countNumber    = 50
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Expire untagged images after a day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
    ]
  })
}
