import argparse
from datetime import date

from certificate_store import IntegrityError, add_certificate, revoke_certificate


def main():
    parser = argparse.ArgumentParser(description="Manage certificate verification records.")
    commands = parser.add_subparsers(dest="command", required=True)

    add_parser = commands.add_parser("add", help="Add an authentic certificate record.")
    add_parser.add_argument("certificate_number")
    add_parser.add_argument("student_name")
    add_parser.add_argument("course")
    add_parser.add_argument("issue_date", help="Issue date in YYYY-MM-DD format")

    revoke_parser = commands.add_parser("revoke", help="Mark a certificate as invalid.")
    revoke_parser.add_argument("certificate_number")
    args = parser.parse_args()

    try:
        if args.command == "add":
            date.fromisoformat(args.issue_date)
            add_certificate(
                args.certificate_number,
                args.student_name,
                args.issue_date,
                args.course,
            )
            print(f"Added certificate {args.certificate_number}.")
        elif not revoke_certificate(args.certificate_number):
            parser.error(f"Certificate {args.certificate_number} was not found.")
        else:
            print(f"Revoked certificate {args.certificate_number}.")
    except ValueError as error:
        parser.error(str(error))
    except IntegrityError:
        parser.error("That certificate number already exists.")


if __name__ == "__main__":
    main()
